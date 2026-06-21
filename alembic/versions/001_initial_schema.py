"""Initial EstateCFO schema — all tenancy + real estate models.

Revision ID: 001_initial
Revises:
Create Date: 2026-06-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Tables are created via Base.metadata.create_all on first startup.
    # Run `alembic stamp head` after first boot against Supabase, or use autogenerate
    # with DATABASE_URL set: alembic revision --autogenerate -m "initial"
    pass


def downgrade() -> None:
    pass
