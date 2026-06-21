# EstateCFO

Standalone CFO/CEO decision dashboard for diversified US real estate groups (Construction, Development, REIT, Rental & Lease). Multi-tenant SaaS with Supabase Auth and PostgreSQL.

**Stack:** React 18 + TypeScript + Vite + Tailwind | FastAPI + SQLAlchemy + PostgreSQL (Supabase) | AWS Bedrock (optional AI narratives)

**Design palette:** Primary `#0E3B36`, Accent `#2F8F7A`

---

## 1. Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and sign up (free tier works).
2. Click **New Project**, choose an organization, name it (e.g. `estatecfo-dev`), set a database password, and pick a region close to you.
3. Wait for the project to finish provisioning (~2 minutes).

### Find your credentials

Open your project → **Project Settings** (gear icon) → **API**:

| Variable | Where to find it |
|----------|------------------|
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | **Project URL** (e.g. `https://xxxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** key (secret — backend only, never expose in frontend) |
| `VITE_SUPABASE_ANON_KEY` | **anon public** key (safe for frontend) |

Open **Project Settings** → **API** → **JWT Settings**:

| Variable | Where to find it |
|----------|------------------|
| `SUPABASE_JWT_SECRET` | **JWT Secret** (used by backend to verify tokens) |

Open **Project Settings** → **Database** → **Connection string** → **URI** (use Transaction pooler, port 6543):

| Variable | Where to find it |
|----------|------------------|
| `DATABASE_URL` | PostgreSQL connection string (replace `[YOUR-PASSWORD]`) |

---

## 2. Configure Environment

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env with your Supabase + DATABASE_URL values

# Frontend
cp frontend/.env.example frontend/.env
# Edit frontend/.env with VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL=http://localhost:8000
```

---

## 3. Backend Setup

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
```

Run migrations (creates all tables):

```bash
# From repo root
alembic upgrade head
```

If no migration file exists yet, tables are also created on startup via `Base.metadata.create_all`.

Start the API:

```bash
cd backend
uvicorn main:app --reload --port 8000
```

Verify: [http://localhost:8000/health](http://localhost:8000/health) → `{"status":"ok"}`

API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 4. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## 5. First-Time Usage

1. Go to **Register** and create a company account (this creates a Tenant + owner TenantUser in Supabase).
2. Sign in and confirm `/api/auth/me` returns your `tenant_id` and `role: owner`.
3. Seed demo data (requires the tenant UUID from registration):

```bash
cd backend
python scripts/seed_demo_tenant.py --tenant-id <your-tenant-uuid>
```

4. Refresh the dashboard — all 8 pages should show seeded US real estate data.

---

## 6. Multi-Tenant Security Checks

- Unauthenticated requests to `/api/real-estate/*` return **401**.
- `tenant_id` is **never** accepted from the client — always derived from JWT + TenantUser lookup.
- Users from Tenant A hitting any GET endpoint see **empty results** for Tenant B's data (not errors, not leaked rows).
- `viewer` / `analyst` roles get **403** on POST/PUT endpoints.

---

## 7. Optional: AI Narrative (Week 4)

Add AWS credentials to `backend/.env`:

```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

Toggle **AI narrative summaries** in Settings. When off, all AI endpoints return template text with **zero** Bedrock calls (verifiable via network tab + AI Usage Log).

---

## Repo Structure

```
├── frontend/          # React app (estatecfo)
├── backend/           # FastAPI app (estatecfo-api)
├── alembic/           # Database migrations
├── README.md
└── .gitignore
```

---

## Role-Based Access

| Role | Read | Write |
|------|------|-------|
| owner, admin, cfo, controller | ✓ | ✓ |
| analyst, viewer | ✓ | ✗ |

---

## License

Proprietary — internal use.
