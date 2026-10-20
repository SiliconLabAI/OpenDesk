# Newsjack Web (Full Mode)

TanStack Start app that productizes [newsjack.sh](https://newsjack.sh) skills:

| Layer | Role |
| --- | --- |
| **TanStack Start** | UI, server functions, `/api/webhooks/manus` |
| **Supabase** | Orgs, clients, monitors, seen-state, jobs, artifacts |
| **Manus API** | Browser worker for `press-clip` & `coverage-reel` |
| **Anthropic / OpenAI** | Sync skill runs (angles, fact-check, …) |

## Flow (browser jobs)

```
UI → startPressClipJob / startCoverageReelJob
   → Manus task.create (Playwright connector)
   → jobs row status=waiting_manus
   → Manus POST /api/webhooks/manus
   → listMessages + artifacts → status=completed
```

## Setup

```bash
npm install
cp .env.example .env
```

1. Supabase: run `supabase/migrations/001_full_mode.sql`
2. Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MANUS_API_KEY`
3. Register webhook (public HTTPS URL required):

```bash
curl -X POST https://api.manus.ai/v2/webhook.create \
  -H "x-manus-api-key: $MANUS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://YOUR_HOST/api/webhooks/manus\"}"
```

```bash
npm run dev
```

## Routes

- `/tools/$slug` — skills (press-clip / coverage-reel start Manus jobs)
- `/monitors` — durable monitor profiles
- `/runs` — job history + artifacts
- `/api/webhooks/manus` — Manus callbacks

Upstream: [elvisun/newsjack](https://github.com/elvisun/newsjack).
