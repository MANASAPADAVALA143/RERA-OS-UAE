"""
AWS Bedrock Claude LLM integration for AI Assistant.

Models tried (in order of preference):
1. Claude 3.5 Sonnet (primary) — if access granted in Bedrock account
2. Amazon Nova Lite (fallback) — if Claude not yet available
   TODO: Remove fallback once Claude model access confirmed in AWS Console
   (Bedrock → Model access → request Claude 3.5 Sonnet)

IAM permission required (scoped in infra/terraform/iam.tf):
  bedrock:InvokeModel on Claude and/or Nova Lite model ARNs
  and the cross-region inference profile ARN.

In production the IAM role attached to the compute resource (EC2 instance
profile or ECS task role) provides credentials automatically. Static
aws_access_key_id / aws_secret_access_key are only used locally.

Data retention: OFF (default) — Bedrock does not retain prompts/outputs.
No customer data is used for model training.
"""
from __future__ import annotations

import json
import logging

from config import settings

logger = logging.getLogger(__name__)

# Try Claude first; fall back to Nova Lite if not available
CLAUDE_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"
NOVA_MODEL_ID = "us.amazon.nova-lite-v1:0"
MODEL_ID = CLAUDE_MODEL_ID  # Primary; will try Nova Lite on 403 Forbidden


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
    Invoke Claude (or fallback to Nova Lite) and return {"text": str, "success": bool, "error": str|None}.

    Returns success=False (never raises) so callers can fall back to non-AI text
    without crashing the request.

    Data retention: OFF (default). Bedrock does not retain prompts/outputs.
    """
    try:
        client = _bedrock_client()
    except Exception as exc:
        logger.exception("Failed to create Bedrock client")
        return {"text": "", "success": False, "error": str(exc)}

    # Try Claude first
    model_to_try = CLAUDE_MODEL_ID

    for attempt, model_id in enumerate([CLAUDE_MODEL_ID, NOVA_MODEL_ID]):
        try:
            # Claude uses converse API; Nova Lite uses invoke_model
            if "claude" in model_id.lower():
                response = client.converse(
                    modelId=model_id,
                    messages=[{"role": "user", "content": [{"text": prompt}]}],
                    inferenceConfig={"maxTokens": max_tokens, "temperature": 0.3},
                )
                text = response.get("output", {}).get("message", {}).get("content", [{}])[0].get("text", "")
            else:
                # Nova Lite fallback
                body = json.dumps({
                    "messages": [{"role": "user", "content": [{"text": prompt}]}],
                    "inferenceConfig": {"maxTokens": max_tokens, "temperature": 0.3},
                })
                response = client.invoke_model(
                    modelId=model_id,
                    body=body,
                    contentType="application/json",
                    accept="application/json",
                )
                result = json.loads(response["body"].read())
                text = result.get("output", {}).get("message", {}).get("content", [{}])[0].get("text", "")

            logger.info("LLM call succeeded (prompt_len=%d, model=%s)", len(prompt), model_id)
            return {"text": text.strip(), "success": bool(text), "error": None}

        except client.exceptions.AccessDeniedException:
            if attempt == 0 and model_id == CLAUDE_MODEL_ID:
                logger.warning("Claude model access not yet enabled; falling back to Nova Lite")
                continue
            logger.exception("LLM model access denied for %s", model_id)
            return {"text": "", "success": False, "error": f"Model access denied: {model_id}"}
        except Exception as exc:
            if attempt < 1:
                logger.warning("Model %s failed, trying fallback: %s", model_id, str(exc))
                continue
            logger.exception("All LLM models failed")
            return {"text": "", "success": False, "error": str(exc)}

    return {"text": "", "success": False, "error": "No LLM models available"}
