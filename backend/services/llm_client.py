"""Single entry point for AWS Bedrock Nova Lite narrative calls."""
import json
import logging

from config import settings

logger = logging.getLogger(__name__)

NOVA_MODEL_ID = "us.amazon.nova-lite-v1:0"


def invoke_narrative(prompt: str, max_tokens: int = 300) -> dict:
    if not settings.aws_access_key_id or not settings.aws_secret_access_key:
        return {"text": "", "success": False, "error": "AWS credentials not configured"}

    try:
        import boto3

        client = boto3.client(
            "bedrock-runtime",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )

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
        logger.info("Bedrock payload sent (prompt length=%d)", len(prompt))
        return {"text": text.strip(), "success": bool(text), "error": None}
    except Exception as exc:
        logger.exception("Bedrock invoke failed")
        return {"text": "", "success": False, "error": str(exc)}
