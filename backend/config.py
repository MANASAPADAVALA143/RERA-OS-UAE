from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Auth ──────────────────────────────────────────────────────────────────
    # "local" = SQLite + email/password (no Supabase). "supabase" = production auth.
    auth_mode: str = ""
    local_jwt_secret: str = "estatecfo-local-dev-secret-change-in-production"
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    # ── Database ──────────────────────────────────────────────────────────────
    # Priority order: DATABASE_URL > RDS_SECRET_ARN > local SQLite
    database_url: str = ""
    rds_secret_arn: str = ""  # Secrets Manager ARN for RDS app-role credentials

    # ── AWS ───────────────────────────────────────────────────────────────────
    aws_access_key_id: str = ""      # Leave empty in production — IAM role is used instead
    aws_secret_access_key: str = ""  # Leave empty in production — IAM role is used instead
    aws_region: str = "us-east-1"

    # ── S3 file storage ───────────────────────────────────────────────────────
    # Set to the bucket name output by Terraform (outputs.tf → s3_bucket_name).
    # Leave empty for local dev (files go to backend/uploads/ on disk).
    s3_bucket: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"

    @property
    def effective_auth_mode(self) -> str:
        if self.auth_mode in ("local", "supabase"):
            return self.auth_mode
        return "supabase" if (self.supabase_url and self.supabase_jwt_secret) else "local"

    @property
    def effective_database_url(self) -> str:
        # 1. Explicit DATABASE_URL env var takes top priority (useful for CI / manual override)
        if self.database_url:
            return self.database_url

        # 2. Read RDS credentials from Secrets Manager (production path)
        if self.rds_secret_arn:
            from services.secrets_manager import build_database_url_from_secret
            url = build_database_url_from_secret(self.rds_secret_arn)
            if url:
                return url

        # 3. Local SQLite fallback (development only)
        db_path = Path(__file__).resolve().parent / "data" / "estatecfo.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{db_path.as_posix()}"


settings = Settings()
