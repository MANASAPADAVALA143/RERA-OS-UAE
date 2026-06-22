"""
AWS Bedrock Nova Lite narrative calls.

IAM permission required (scoped in infra/terraform/iam.tf):
  bedrock:InvokeModel on arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0
  and the cross-region inference profile ARN.

In production the IAM role attached to the compute resource (EC2 instance
profile or ECS task role) provides credentials automatically. Static
aws_access_key_id / aws_secret_access_key are only used locally.
"""
from __future__ import annotations

import json
import logging

from config import settings

logger = logging.getLogger(__name__)

NOVA_MODEL_ID = "us.amazon.nova-lite-v1:0"


def _bedrock_client():
    """Return a bedrock-runtime client. Prefers IAM role; uses static keys only if set."""
    import boto3

    kwargs: dict = {"region_name": settings.aws_region}
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        # Local dev / CI path — production should NOT have these set
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return boto3.client("bedrock-runtime", **kwargs)


def invoke_narrative(prompt: str, max_tokens: int = 300) -> dict:
    """
    Invoke Nova Lite and return {"text": str, "success": bool, "error": str|None}.

    Returns success=False (never raises) so callers can fall back to non-AI text
    without crashing the request.
    """
    try:
        client = _bedrock_client()
    except Exception as exc:
        logger.exception("Failed to create Bedrock client")
        return {"text": "", "success": False, "error": str(exc)}

    try:
        body = json.dumps({
            "messages": [{"role": "user", "content": [{"text": prompt}]}],
            "inferenceConfig": {"maxTokens": max_tokens, "temperature": 0.3},
        })

        response = client.invoke_model(
            modelId=NOVA_MODEL_ID,
            body=body,
            contentType="application/json",
            accept="application/json",
        )

        result = json.loads(response["body"].read())
        text = result.get("output", {}).get("message", {}).get("content", [{}])[0].get("text", "")
        logger.info("Bedrock Nova Lite call succeeded (prompt_len=%d, model=%s)", len(prompt), NOVA_MODEL_ID)
        return {"text": text.strip(), "success": bool(text), "error": None}

    except Exception as exc:
        logger.exception("Bedrock invoke_model failed")
        return {"text": "", "success": False, "error": str(exc)}
