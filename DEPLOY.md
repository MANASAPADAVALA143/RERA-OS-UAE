# Deploy — all on Vercel + Supabase (free)

Two Vercel projects from this one repo:

| Project | Root directory | What it is |
|---|---|---|
| `rera-os-uae` (frontend) | `frontend` | Vite/React static site |
| `rera-os-uae-api` (backend) | `backend` | FastAPI as a Python serverless function (`backend/api/index.py`) |

Database: your existing **Supabase** project.

Free-tier limits that matter for the backend: 60 s max per request, cold starts
after idle, no background jobs, read-only filesystem (file uploads don't persist).
Fine for a demo/prototype.

---

## 1. Database — Supabase (you already have a project)

Supabase → **Project Settings → Database → Connection string → "Session pooler"** (port `6543`).
Take that string and:

1. Fill in your DB password (Settings → Database → reset if unknown).
2. Change the scheme `postgresql://` → `postgresql+psycopg2://`.

Result — this is your `DATABASE_URL`:
```
postgresql+psycopg2://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Use the **pooler** host, never `db.<ref>.supabase.co` (IPv6-only, unreachable from serverless).

---

## 2. Seed the database — once, from your laptop

Serverless can't run a long seed on cold start, so do it locally against Supabase:

```bash
cd backend
# Windows PowerShell:
$env:DATABASE_URL = "postgresql+psycopg2://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres"
$env:AUTH_MODE = "local"
.venv\Scripts\python.exe -c "import main"          # creates all tables
.venv\Scripts\python.exe scripts\seed_demo_data.py # seeds all 4 modules
```

Login created: `demo@reraos.demo` / `DemoRera2026!`

---

## 3. Backend — Vercel project #1

1. https://vercel.com → **Add New → Project** → import this repo.
2. **Root Directory: `backend`**
3. Framework preset: **Other** (Vercel auto-detects `api/index.py` + `requirements.txt`; `backend/vercel.json` routes all paths to it).
4. Environment Variables:
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the pooler string from step 1 |
   | `LOCAL_JWT_SECRET` | any long random string |
5. Deploy → note the URL, e.g. `https://rera-os-uae-api.vercel.app`
6. Test: open `https://rera-os-uae-api.vercel.app/health` → `{"status":"ok",...}`

---

## 4. Frontend — Vercel project #2

1. **Add New → Project** → same repo again.
2. **Root Directory: `frontend`** (Vite preset auto-detected via `frontend/vercel.json`).
3. Environment Variable:
   | Key | Value |
   |---|---|
   | `VITE_API_URL` | backend **hostname only, no `https://`** — e.g. `rera-os-uae-api.vercel.app` |
4. Deploy → `https://rera-os-uae.vercel.app`

CORS: `backend/main.py` already allows any `*.vercel.app` origin, so no extra
config is needed. `FRONTEND_URL` / `CORS_ALLOW_ORIGINS` on the backend are only
needed if you attach a custom (non-`.vercel.app`) domain.

---

## Redeploys

Both projects auto-deploy on push to `main`. To reseed or reset data, re-run
step 2 from your laptop.

## If you later want an always-on backend

Move the backend to **Koyeb** or **Render** (no code change — `render.yaml` is
still in the repo). The Vercel serverless path keeps working as-is.
