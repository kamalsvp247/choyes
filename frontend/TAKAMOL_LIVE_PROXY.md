# Takamol live proxy configuration

The Takamol frontend calls the Supabase Edge Function `takamol-proxy`. The function calls the live Laravel API at `https://t2hub.app/takamol/api`, decrypts `{ p, iv }` AES-GCM response envelopes server-side, and returns the normalized `{ success, data }` contract used by the React application.

## Supabase Edge Function secrets

Set these secrets for the Supabase project. The encryption key is the base64 value used by the live Takamol page’s AES-GCM helper. It must be stored only as a Supabase function secret and must never be committed or exposed as a `VITE_` variable.

```bash
supabase secrets set \
  TAKAMOL_LIVE_API_URL=https://t2hub.app/takamol/api \
  TAKAMOL_ENCRYPTION_KEY_B64=REPLACE_WITH_THE_LIVE_BASE64_KEY \
  TAKAMOL_SESSION_COOKIE=REPLACE_WITH_SERVER_SIDE_TAKAMOL_SESSION_COOKIE \
  TAKAMOL_XSRF_TOKEN=REPLACE_WITH_SERVER_SIDE_XSRF_TOKEN \
  --project-ref xklwzkraobxetxdcysun
```

`TAKAMOL_SESSION_COOKIE` and `TAKAMOL_XSRF_TOKEN` are optional server-side fallbacks. Configure them only when the proxy must use a maintained authenticated t2hub session; never expose them as `VITE_` variables. The session cookie may rotate, so this fallback requires a refresh process or, preferably, a same-origin Laravel route.

The proxy maps the application routes as follows:

Client-facing live data calls use the neutral `/live/*` aliases below. The
legacy `/t2hub/*` paths remain accepted by the proxy so older deployments and
bookmarks continue to work.

| Application route | Live route | Normalized result |
|---|---|---|
| `/api/takamol/categories` | `/pacc/occupations?exclude_ignored=1` | `{ categories }` |
| `/api/takamol/dates` | `/exam-available-dates` | `{ dates, cities, sessions, source }` |
| `/api/takamol/centers` | `/test-centers` | `{ centers }` |
| `/api/takamol/sessions` | `/fix-search-mode`, then `/pacc-exam-sessions` | `{ sessions }` |

The public alias routes are `/live/occupations`, `/live/exam-available-dates`,
`/live/test-centers`, `/live/pacc-exam-sessions`, `/live/exam-sessions-bulk`,
and `/live/session-status`.

## Vercel frontend variables

In the Vercel project’s **Production** environment, configure the following public variables:

```text
VITE_SUPABASE_URL=https://xklwzkraobxetxdcysun.supabase.co
VITE_SUPABASE_PROJECT_ID=xklwzkraobxetxdcysun
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_JWKS_URL=https://xklwzkraobxetxdcysun.supabase.co/auth/v1/.well-known/jwks.json
```

For the repository-contained Supabase proxy path, set this public Vercel variable in Production and Preview:

```text
VITE_TAKAMOL_API_URL=https://xklwzkraobxetxdcysun.supabase.co/functions/v1/takamol-proxy
```

When `VITE_TAKAMOL_API_URL` is unset, the frontend also falls back to the same Supabase proxy URL:

```text
${VITE_SUPABASE_URL}/functions/v1/takamol-proxy
```

Do not put `TAKAMOL_ENCRYPTION_KEY_B64`, `SUPABASE_ACCESS_TOKEN`, or `SUPABASE_DB_PASSWORD` in Vercel public frontend variables.

## GitHub Actions

The repository workflow requires these GitHub Actions secrets:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
SUPABASE_DB_PASSWORD   # required for migrations; optional for function-only deploys
```

The workflow deploys `takamol-proxy` together with the existing Edge Functions whenever `frontend/supabase/functions/**` or `frontend/supabase/migrations/**` changes on `main` or `agents/hi`.

After the Edge Function is deployed, set the function secrets and redeploy the function. A GitHub Actions function deployment does not automatically set Supabase function secrets unless a separate secret-management step is added.
