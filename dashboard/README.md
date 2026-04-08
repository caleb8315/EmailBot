# Jeff Intelligence — web dashboard

Next.js UI hosted on **Vercel (free tier)** for digest history, system events, recent articles, GitHub Actions triggers, and the same **AI assistant** as Telegram.

**Important:** RSS polling and scoring still run on **GitHub Actions** (or `npm start` locally). The dashboard does not replace the scheduler — it is control + visibility.

## Deploy on Vercel

1. Push this repo to GitHub.
2. In [Vercel](https://vercel.com) → New Project → import the repo.
3. Set **Root Directory** to `dashboard` (required).
4. Add **Environment Variables** (Production):

| Variable | Purpose |
|----------|---------|
| `DASHBOARD_SECRET` | Long random string; you type it into the UI to unlock APIs |
| `SUPABASE_URL` | Same as pipeline |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as pipeline (server-only) |
| `OPENAI_API_KEY` | Assistant + same models as main app |
| `TELEGRAM_CHAT_ID` | Your user id (matches pipeline `DEFAULT_USER_ID`) |
| `GITHUB_TOKEN` | PAT with `repo` + **Actions** (read + workflow dispatch) |
| `GITHUB_REPO` | `yourname/repo-name` |
| `GITHUB_DISPATCH_REF` | Optional, default `main` |
| `TELEGRAM_BOT_TOKEN` | For Telegram **webhook** replies (optional if you only use the dashboard chat) |
| `TELEGRAM_WEBHOOK_SECRET` | Random string; use in `setWebhook` below |

5. Deploy. Open the site → enter **Dashboard secret** → Save → Refresh.

## Telegram webhook (optional)

Stops needing `npm run bot` on your laptop. **Vercel Hobby** functions have a **short max duration**; if replies time out, keep using `npm run bot` on a small VM or Railway.

```bash
SECRET="same-as-TELEGRAM_WEBHOOK_SECRET"
URL="https://YOUR_PROJECT.vercel.app/api/telegram/webhook"
curl -s -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=${URL}" \
  -d "secret_token=${SECRET}"
```

Delete webhook (return to polling bot):  
`https://api.telegram.org/bot<TOKEN>/deleteWebhook`

## Local dev

```bash
cd dashboard
npm install
# copy env from Vercel or use .env.local (Next loads it automatically)
npm run dev
```

Open http://localhost:3001

## Monorepo note

API routes import `../src/*` from the repo root via `experimental.externalDir`. Vercel must use **Root Directory = `dashboard`** so the parent `src/` folder is included in the build context.
