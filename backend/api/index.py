"""
Vercel serverless entrypoint.

Vercel's Python runtime serves any module-level object named ``app`` that is an
ASGI application, so this file just re-exports the FastAPI app from ``main``.
The ``backend/vercel.json`` rewrite sends every request path here.
"""
import sys
from pathlib import Path

# On Vercel the function runs with the project root (backend/) as cwd, but make
# the import explicit so it also works when invoked from elsewhere.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app  # noqa: E402,F401
