from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # "local" = SQLite + email/password (no Supabase). "supabase" = production auth.
    auth_mode: str = ""
    local_jwt_secret: str = "estatecfo-local-dev-secret-change-in-production"
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    database_url: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"

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
        if self.database_url:
            return self.database_url
        db_path = Path(__file__).resolve().parent / "data" / "estatecfo.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{db_path.as_posix()}"


settings = Settings()
