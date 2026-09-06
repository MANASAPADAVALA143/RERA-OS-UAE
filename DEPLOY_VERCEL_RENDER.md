# Deploy: Vercel (frontend) + Render (backend) + Supabase (DB)

All three have free tiers. Total cost: **$0** for a demo.

---

## 1. Database — Supabase (free)

1. https://supabase.com → **New project**. Pick a region near your users. Save the DB password.
2. **Project Settings → Database → Connection string → "Session pooler"** (port `6543`).
   Copy it — looks like:
   ```
   postgresql://postgres.abcdxyz:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
   Use the **pooler** host, not the direct `db.<ref>.supabase.co` host (that one is IPv6-only and Render can't reach it).
3. Convert the scheme for SQLAlchemy: `postgresql://` → `postgresql+psycopg2://`.
   This full string is your `DATABASE_URL`.

Tables auto-create on first backend boot (`Base.metadata.create_all`). No migration step.

---

## 2. Backend — Render (free)

1. https://render.com → **New → Web Service** → connect this GitHub repo.
2. Render reads `render.yaml`. Confirm:
   - Root directory: `backend`
   - Build: `pip install -r requirements.txt`
   - Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Plan: **Free**
3. Set env vars (Render dashboard → Environment):
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the `postgresql+psycopg2://...pooler...:6543/postgres` string from step 1 |
   | `LOCAL_JWT_SECRET` | click "Generate" |
   | `FRONTEND_URL` | your Vercel URL (fill in after step 3), e.g. `https://rera-os-uae.vercel.app` |
   | `CORS_ALLOW_ORIGINS` | same as `FRONTEND_URL` |
4. Deploy. Note the service URL, e.g. `https://estatecfo-api.onrender.com`.
5. Seed demo data once (Render dashboard → **Shell**):
   ```bash
   python scripts/seed_demo_data.py
   ```
   Login after that: `demo@reraos.demo` / `DemoRera2026!`

> Free plan sleeps after 15 min idle → first request cold-starts (~50 s). The
> frontend has retry logic for this. Upgrade to Starter ($7/mo) to keep it warm.

---

## 3. Frontend — Vercel (free)

1. https://vercel.com → **Add New → Project** → import this repo.
2. **Root Directory: `frontend`** (important — the app is in a subfolder).
   Framework preset auto-detects as Vite via `frontend/vercel.json`.
3. Environment Variables:
   | Key | Value |
   |---|---|
   | `VITE_API_URL` | backend **hostname only, no `https://`** — e.g. `estatecfo-api.onrender.com` |
4. Deploy. You get `https://<project>.vercel.app`.
5. Go back to Render and set `FRONTEND_URL` + `CORS_ALLOW_ORIGINS` to this exact URL, then redeploy the backend (or just "Clear cache & deploy").

CORS for any `*.vercel.app` / `*.onrender.com` / `localhost` is already allowed by
regex in `backend/main.py`, so preview deployments work without extra config. The
explicit `CORS_ALLOW_ORIGINS` only matters if you attach a custom domain.

---

## Custom domain (optional)

- Vercel: Project → Settings → Domains → add yours.
- Then on Render set `FRONTEND_URL` / `CORS_ALLOW_ORIGINS` to `https://yourdomain.com` and redeploy.

## Redeploys

Both Vercel and Render auto-deploy on push to the connected branch. Merge this
branch to `master` (or point them at `claude/consultancy-and-demo-data`) first.
