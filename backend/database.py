from sqlalchemy import create_engine, event, text as sqla_text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from config import settings

_db_url = settings.effective_database_url
is_sqlite = _db_url.startswith("sqlite")  # exported — used by middleware/auth.py for RLS guard

# Enforce SSL on all PostgreSQL connections
if not is_sqlite and "sslmode" not in _db_url:
    _db_url += ("&" if "?" in _db_url else "?") + "sslmode=require"

engine_kwargs: dict = {"pool_pre_ping": True}
if is_sqlite:
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs["pool_size"] = 5
    engine_kwargs["max_overflow"] = 10

engine = create_engine(_db_url, **engine_kwargs)

if is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragma(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def set_rls_tenant(db, tenant_id: str) -> None:
    """
    Set the Postgres RLS session variable for this transaction.

    Must be called once per request, after the tenant is known from the verified JWT,
    before any data queries run. Uses SET LOCAL so the variable is scoped to the
    current transaction and automatically cleared on commit/rollback — safe with
    connection pooling.

    No-op on SQLite (local dev).
    """
    if is_sqlite:
        return
    try:
        db.execute(sqla_text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            "Failed to set RLS tenant context — queries will be blocked by RLS policy"
        )
