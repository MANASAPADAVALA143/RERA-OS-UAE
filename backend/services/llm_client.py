"""
AWS Bedrock Claude LLM integration with smart model routing.

Routing strategy (cost optimisation):
  Haiku 4.5  → short factual labels, KPI narratives, status summaries
               ($0.80 input / $4 output per 1M tokens)
  Sonnet 4.6 → CFO insights, chat, deal analysis, risk assessment
               ($3 input / $15 output per 1M tokens)
  Nova Lite  → final fallback only if both Claude models fail
               (~$0)

Expected split: ~70% Haiku / ~30% Sonnet → ~50% cost reduction vs
single-Sonnet approach.

IAM: bedrock:InvokeModel scoped to both model ARNs in infra/terraform/iam.tf.
In production the task/instance role provides credentials automatically.
Static keys are used for local dev only (never commit them).

Data retention: OFF (Bedrock default). No prompts or outputs are retained
for model training.
"""
from __future__ import annotations

import json
import logging

from config import settings

logger = logging.getLogger(__name__)

# ── Model IDs ─────────────────────────────────────────────────────────────────

HAIKU_MODEL  = "anthropic.claude-haiku-4-5-20251001-v1:0"
SONNET_MODEL = "anthropic.claude-sonnet-4-6-20250514-v1:0"
NOVA_LITE    = "us.amazon.nova-lite-v1:0"   # final fallback only

# ── Task routing ──────────────────────────────────────────────────────────────

# Short factual outputs that don't need reasoning depth → Haiku
_HAIKU_TASKS = {
    "kpi_narrative",       # "Occupancy 93.5%, up 2.1%"
    "variance_label",      # "Revenue +$12K vs budget"
    "ar_aging_summary",    # "2 units 30+ days overdue"
    "occupancy_status",    # "29/31 units occupied"
    "loan_status",         # "EMI due 10th, $17,645"
    "expense_label",       # "Interest $32K = 38% of revenue"
    "collection_summary",  # "95.2% collection rate"
    "unit_status",         # "Unit A occupied, $850/mo"
    "simple_summary",      # Any short factual summary
}

# Multi-step analysis, user chat, strategic recommendations → Sonnet
_SONNET_TASKS = {
    "cfo_insight",
    "chat_query",
    "deal_analysis",
    "strategic_recommendation",
    "financial_narrative",
    "risk_assessment",
    "partner_distribution",
    "scenario_analysis",
}


def get_model(task_type: str) -> str:
    """Return the model ID appropriate for the given task type."""
    return HAIKU_MODEL if task_type in _HAIKU_TASKS else SONNET_MODEL


# ── Bedrock client ────────────────────────────────────────────────────────────

def _bedrock_client():
    """Return a bedrock-runtime boto3 client.
    Prefers IAM role (production); falls back to static keys for local dev."""
    import boto3

    kwargs: dict = {"region_name": settings.aws_region}
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"]     = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return boto3.client("bedrock-runtime", **kwargs)


# ── Core invocation ───────────────────────────────────────────────────────────

def invoke_narrative(
    prompt: str,
    task_type: str = "cfo_insight",
    max_tokens: int = 300,
) -> dict:
    """
    Invoke a Claude model (routed by task_type) with Nova Lite as final fallback.

    Returns {"text": str, "success": bool, "model": str, "error": str|None}.
    Never raises — callers can always fall back to non-AI text.

    Data retention: OFF (Bedrock default).
    """
    try:
        client = _bedrock_client()
    except Exception as exc:
        logger.exception("Failed to create Bedrock client")
        return {"text": "", "success": False, "model": "", "error": str(exc)}

    primary_model = get_model(task_type)
    # Try routed model first, then Nova Lite as last resort
    candidates = [primary_model, NOVA_LITE]

    for attempt, model_id in enumerate(candidates):
        try:
            if "claude" in model_id.lower():
                # Claude models: use Converse API
                response = client.converse(
                    modelId=model_id,
                    messages=[{"role": "user", "content": [{"text": prompt}]}],
                    inferenceConfig={"maxTokens": max_tokens, "temperature": 0.3},
                )
                msg = response.get("output", {}).get("message", {})
                text = msg.get("content", [{}])[0].get("text", "")
                usage = response.get("usage", {})
                input_tokens  = usage.get("inputTokens",  0)
                output_tokens = usage.get("outputTokens", 0)
            else:
                # Nova Lite: invoke_model path
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
                text = (
                    result.get("output", {})
                          .get("message", {})
                          .get("content", [{}])[0]
                          .get("text", "")
                )
                input_tokens  = result.get("usage", {}).get("inputTokens",  0)
                output_tokens = result.get("usage", {}).get("outputTokens", 0)

            logger.info(
                "Bedrock call: task=%s model=%s input_tokens=%d output_tokens=%d",
                task_type, model_id, input_tokens, output_tokens,
            )
            return {
                "text":    text.strip(),
                "success": bool(text),
                "model":   model_id,
                "error":   None,
            }

        except Exception as exc:
            is_access_denied = (
                hasattr(client, "exceptions")
                and isinstance(exc, client.exceptions.AccessDeniedException)
            )
            if attempt == 0:
                reason = "access denied" if is_access_denied else str(exc)
                logger.warning(
                    "Model %s failed (%s) — falling back to Nova Lite",
                    model_id, reason,
                )
                continue
            logger.exception("All LLM models failed for task=%s", task_type)
            return {"text": "", "success": False, "model": model_id, "error": str(exc)}

    return {"text": "", "success": False, "model": "", "error": "No LLM models available"}
