# Ricotdin — Meeting Assistant

Record meetings in the browser → AI transcript + summary + to-dos + RAG chatbot.  
Powered by Next.js, Supabase, and Google Gemini.

---

## Running with Docker

The container runs Nginx on **port 3333** as a reverse proxy in front of the Next.js server.

### Prerequisites

- Docker 20+
- A [Supabase](https://supabase.com) project (URL, anon key, service role key)
- A [Google AI Studio](https://aistudio.google.com) API key

### 1 — Build the image

`NEXT_PUBLIC_*` variables are inlined into the client bundle at build time, so they must be passed as `--build-arg`:

```bash
docker build --build-arg NEXT_PUBLIC_SUPABASE_URL="https://zytzbinwojhmmemoxbcr.supabase.co" --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5dHpiaW53b2pobW1lbW94YmNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MDExMzcsImV4cCI6MjA5NjQ3NzEzN30.smSodXjJwdzOgRKQFvnDZtqOrYcAix2XuK9XgZl-t4c" -t ricotdin .
```

### 2 — Run the container

Server-only secrets are injected at runtime and never touch the image:

```bash
docker run -d -p 3333:3333  -e SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5dHpiaW53b2pobW1lbW94YmNyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDkwMTEzNywiZXhwIjoyMDk2NDc3MTM3fQ.Nvz-jw37cf8Yf2hBzfLZgUhk6zzdFDeD6UmcLxxMJaI" -e GEMINI_API_KEY="AQ.Ab8RN6JUD1pu8rdhweX0mzPl-5juF9d-N4oYzKfuc4yOT-_p0A"  --name ricotdin ricotdin
```
AQ.Ab8RN6JUD1pu8rdhweX0mzPl-5juF9d-N4oYzKfuc4yOT-_p0A
Open **http://localhost:3333**.

### Using an env file (alternative)

Create `.env.runtime` (do **not** commit it):

```env
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
```

```bash
docker run -d \
  -p 3333:3333 \
  --env-file .env.runtime \
  --name ricotdin \
  ricotdin
```

### Stop / remove

```bash
docker stop ricotdin && docker rm ricotdin
```

### Rebuild after code changes

```bash
docker stop ricotdin && docker rm ricotdin
docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... -t ricotdin .
docker run -d -p 3333:3333 --env-file .env.runtime --name ricotdin ricotdin
```

---

## Environment variables

| Variable | Where supplied | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `--build-arg` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `--build-arg` | Supabase anon key (safe to expose) |
| `SUPABASE_SERVICE_ROLE_KEY` | runtime `-e` | Service role key — **never expose** |
| `GEMINI_API_KEY` | runtime `-e` | Google AI Studio key — **never expose** |

---

## Local development (without Docker)

```bash
cp .env.example .env.local   # fill in all four values
npm install
npm run dev                  # http://localhost:3000
```

Other useful commands:

```bash
npm run check   # verify Supabase + Gemini connectivity
npm run lint    # ESLint
npm test        # unit tests
```

### First-time Supabase setup

Before the pipeline works end-to-end, do these once in the Supabase dashboard:

1. **Storage bucket** — Dashboard → Storage → New bucket → Name: `recordings` → uncheck "Public bucket"
2. **Anonymous sign-ins** — Dashboard → Authentication → Providers → Anonymous sign-ins → Enable
