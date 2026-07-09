# RERA OS — Public Demo

Standalone **public demo** fork of the EstateCFO rental analytics stack. Completely disconnected from any production client, AWS RDS, or private Supabase projects.

**Stack:** React 18 + TypeScript + Vite + Tailwind | FastAPI + SQLAlchemy + PostgreSQL (Supabase)

**Design palette:** Indigo `#6366F1` · Purple `#7C3AED` · Teal `#14B8A6` · Page background `#EEF2FF`

---

## What’s in the demo

- **4 fictional UAE rental entities** (Marina Heights, Palm Vista, Business Bay Tower, JBR Coastal Suites)
- Synthetic tenants, leases, invoices, collections, expenses, and ownership
- **No real client data** — AKK Consulting references and WWBG production seeds removed
- KPI formulas and NOI hierarchy unchanged (calculation logic only)

**Demo login (local mode):** `demo@reraos.demo` / `DemoRera2026!`

---

## 1. Create a new Supabase project

1. Go to [https://supabase.com](https://supabase.com) and create a **new** project (do not reuse a production project).
2. Note your database password and wait for provisioning (~2 minutes).

### Credentials

| Variable | Where |
|----------|--------|
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Project Settings → API → **Project URL** |
| `SUPABASE_SERVICE_ROLE_KEY` | API → **service_role** (backend only) |
| `VITE_SUPABASE_ANON_KEY` | API → **anon public** |
| `SUPABASE_JWT_SECRET` | API → JWT Settings → **JWT Secret** |
| `DATABASE_URL` | Database → Connection string → URI (Transaction pooler, port **6543**) |

Use the `postgresql+psycopg2://` prefix in `DATABASE_URL` for SQLAlchemy.

---

## 2. Configure environment

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit both files with your **new** Supabase values. Do not copy credentials from any production `.env`.

```bash
# backend/.env
AUTH_MODE=supabase
SUPABASE_URL=https://YOUR_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...
DATABASE_URL=postgresql+psycopg2://postgres.YOUR_REF:PASSWORD@...pooler.supabase.com:6543/postgres
PRIMARY_USER_EMAIL=demo@reraos.demo

# frontend/.env
VITE_API_BASE_URL=http://localhost:8000
VITE_SUPABASE_URL=https://YOUR_REF.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

---

## 3. Run locally

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
cd ..
alembic upgrade head
cd backend
uvicorn main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Or double-click `start.bat` on Windows (after `.env` files are configured).

Open [http://localhost:5173](http://localhost:5173)

---

## 4. Seed demo rental data

**Local (`AUTH_MODE=local`):** Data seeds automatically on first API start.

**Supabase:** Register once in the UI, then:

```bash
cd backend
python scripts/seed_rentals.py
```

This creates 4 companies, 24 units, 6 months of billing/collections, expenses, and ownership — all synthetic.

---

## 5. Quick start without Supabase

For offline demos, set `AUTH_MODE=local` in `backend/.env` and leave Supabase vars empty. SQLite at `backend/data/estatecfo.db` is used automatically.

---

## Repo notes

- `infra/terraform/` — AWS/RDS templates retained for reference; **not used** by this demo fork
- `backend/scripts/seed_wwbg.py` — client-specific; do not run in the public demo
- Never commit `.env` files with real keys

---

## License

Demo use only — not connected to any production tenant.
