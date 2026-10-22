# Newsjack Web (Full Mode)

TanStack Start + Supabase + Manus + Medialyst productization of [newsjack.sh](https://newsjack.sh) skills.

## Implemented

| Area | Status |
| --- | --- |
| All 31 README skills in catalog | Yes (incl. 4 AI-visibility skills) |
| SKILL.md doctrine prompts | angle, fact-check, newsworthiness, meanest-editor, detector, triage, crisis, … |
| Medialyst | news-search, pr-calendar, find-journalists, detector/coverage context |
| Detector pipeline | news → seen-state → LLM judge → jobs + optional Slack |
| Cron | `POST /api/cron/detector` with `CRON_SECRET` |
| Manus browser jobs | press-clip / coverage-reel + webhook RSA verify + Storage upload |
| Auth RLS | migration `002_auth_rls.sql` |

## Setup

```bash
npm install
cp .env.example .env
# Run supabase/migrations/001_full_mode.sql and 002_auth_rls.sql
npm run dev
```

### Env

- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — skill + detector LLM
- `SUPABASE_*` — durable state
- `MEDIALYST_API_KEY` — live news / calendar / journalists
- `MANUS_API_KEY` + `APP_URL` — browser worker
- `CRON_SECRET` — protect detector cron

### Cron

```bash
curl -X POST "$APP_URL/api/cron/detector" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Manus webhook

```bash
curl -X POST https://api.manus.ai/v2/webhook.create \
  -H "x-manus-api-key: $MANUS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$APP_URL/api/webhooks/manus\"}"
```

Upstream skills: [elvisun/newsjack](https://github.com/elvisun/newsjack).


## Supabase migrations

```bash
# apply in order
psql $DATABASE_URL -f supabase/migrations/001_full_mode.sql
psql $DATABASE_URL -f supabase/migrations/002_auth_rls.sql
psql $DATABASE_URL -f supabase/migrations/003_skill_drafts.sql
psql $DATABASE_URL -f supabase/migrations/004_app_state.sql
```

Required env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and optional `DEFAULT_ORG_ID`).

Durable state tables: `client_profiles`, `app_settings`, `chat_threads`, `chat_messages`, `skill_drafts`, `monitors`, `jobs`.
