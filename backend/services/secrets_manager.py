"""
AWS Secrets Manager helper.

Reads RDS credentials at startup so they never need to be in .env files
or committed config. The IAM role attached to the compute resource handles
authentication — no static AWS keys needed in production.
"""
from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


def _client():
    """Return a boto3 secretsmanager client, preferring IAM role over static keys."""
    import boto3
    from config import settings

    kwargs: dict = {"region_name": settings.aws_region}
    # Static keys are only used locally / in CI. On production EC2/ECS the IAM
    # role provides credentials automatically — no keys needed.
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return boto3.client("secretsmanager", **kwargs)


def get_secret(secret_arn: str) -> dict:
    """Retrieve a JSON secret from Secrets Manager. Returns {} on any error."""
    try:
        response = _client().get_secret_value(SecretId=secret_arn)
        return json.loads(response.get("SecretString", "{}"))
    except Exception:
        logger.exception("Failed to retrieve secret %s from Secrets Manager", secret_arn)
        return {}


def build_database_url_from_secret(secret_arn: str) -> str | None:
    """
    Fetch RDS credentials from Secrets Manager and return a SQLAlchemy URL.
    Returns None if the secret is missing or incomplete.

    Expected secret JSON (created by Terraform secrets.tf):
    {
        "username": "estatecfo_app",
        "password": "...",
        "host":     "estatecfo.xxxx.us-east-1.rds.amazonaws.com",
        "port":     5432,
        "dbname":   "estatecfo"
    }
    """
    secret = get_secret(secret_arn)
    host = secret.get("host")
    username = secret.get("username")
    password = secret.get("password")
    if not host or not username or not password:
        logger.error(
            "RDS secret %s is missing host/username/password — falling back to DATABASE_URL or SQLite",
            secret_arn,
        )
        return None
    port = secret.get("port", 5432)
    dbname = secret.get("dbname", "estatecfo")
    # URL-encode password in case it contains special characters
    from urllib.parse import quote_plus
    return f"postgresql+psycopg2://{quote_plus(username)}:{quote_plus(password)}@{host}:{port}/{dbname}"
