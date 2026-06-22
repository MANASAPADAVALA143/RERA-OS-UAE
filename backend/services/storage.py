"""
Unified file storage service.

Production (S3_BUCKET configured):
  - Files are stored in S3 with SSE-KMS encryption.
  - All URLs are pre-signed GET links, valid for 1 hour. The frontend
    never receives long-lived S3 credentials or a permanent public URL.
  - The IAM role attached to the compute resource provides S3 access —
    no static AWS keys needed in production.

Local development (S3_BUCKET not set):
  - Files go to backend/uploads/ on disk.
  - URLs are served from the /uploads/ static mount in main.py.

Callers store the returned key in file_reference columns. The key is
the same format regardless of backend (e.g. "photos/abc123.jpg"), so
no data migration is needed when switching from local to S3.
"""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

PRESIGN_TTL = 3600  # 1 hour — sufficient for a CFO reviewing documents in a session


def _s3():
    """Return a boto3 S3 client. Prefers IAM role; falls back to static keys for local dev."""
    import boto3
    from config import settings

    kwargs: dict = {"region_name": settings.aws_region}
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return boto3.client("s3", **kwargs)


def _bucket() -> str:
    from config import settings
    return settings.s3_bucket


def is_s3_enabled() -> bool:
    from config import settings
    return bool(settings.s3_bucket)


def put_file(content: bytes, key: str, content_type: str = "application/octet-stream") -> str:
    """
    Store file bytes. Returns the key (identical to input key).

    S3: uploads to bucket with SSE-KMS.
    Local: writes to backend/uploads/<key> (creates subdirs as needed).
    """
    if is_s3_enabled():
        try:
            _s3().put_object(
                Bucket=_bucket(),
                Key=key,
                Body=content,
                ContentType=content_type,
                ServerSideEncryption="aws:kms",
            )
            logger.info("S3 upload: s3://%s/%s (%d bytes)", _bucket(), key, len(content))
        except Exception:
            logger.exception("S3 upload failed for key %s", key)
            raise
    else:
        dest = UPLOADS_DIR / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)
    return key


def get_url(key: str) -> str:
    """
    Return a URL suitable for the frontend to download the file.

    S3: pre-signed GET URL, expires in 1 hour.
    Local: /uploads/<key> path served by FastAPI static mount.

    Returns empty string if key is empty or URL generation fails.
    """
    if not key:
        return ""
    if is_s3_enabled():
        try:
            return _s3().generate_presigned_url(
                "get_object",
                Params={"Bucket": _bucket(), "Key": key},
                ExpiresIn=PRESIGN_TTL,
            )
        except Exception:
            logger.exception("Failed to generate pre-signed URL for key %s", key)
            return ""
    return f"/uploads/{key}"


def delete_file(key: str) -> None:
    """Delete a file. Silently ignores missing files."""
    if not key:
        return
    if is_s3_enabled():
        try:
            _s3().delete_object(Bucket=_bucket(), Key=key)
            logger.info("S3 delete: s3://%s/%s", _bucket(), key)
        except Exception:
            logger.exception("S3 delete failed for key %s", key)
    else:
        path = UPLOADS_DIR / key
        if path.exists():
            path.unlink()
