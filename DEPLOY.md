# AFRO Suite — Deployment Guide (VPS)

The whole product ships as **one Express app**: it serves both the marketing site + platform SPA (static files from `/dist`) and the JSON API (`/api/*`). Nginx sits in front as a reverse proxy with TLS.

```
Internet → Nginx :443 ─┬→ static /dist files (SPA, all non-/api routes)
                       └→ proxy /api → Node (pm2, port 4000) → PostgreSQL
```

## 1. Server prerequisites

```bash
# Ubuntu 22.04/24.04 example
sudo apt update && sudo apt install -y nginx postgresql git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

## 2. PostgreSQL

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE afro_suite;
ALTER USER postgres WITH PASSWORD '<strong-password>';
SQL
```

## 3. Deploy the app

```bash
cd /var/www
git clone <your-repo> portfolio-main   # or rsync/scp the folder up
cd portfolio-main

# ── Frontend ──
npm ci
npm run build                          # outputs dist/

# ── Backend ──
cd server
npm ci
cp .env.example .env
nano .env                              # set DB_*, JWT_SECRET, ADMIN_*, NODE_ENV=production
npm run migrate                        # creates all tables
npm run seed                           # creates the AFRO-TECH admin account
npm run build                          # compiles TS to dist/
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup                # survive reboots
```

> Generate a strong JWT secret with:
> `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

## 4. Nginx site

`/etc/nginx/sites-available/afrotech`:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Serve the built SPA
    root /var/www/portfolio-main/dist;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # API → Node
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static assets caching
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback (React Router)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/afrotech /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Then add TLS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## 5. Updating

```bash
cd /var/www/portfolio-main && git pull
npm ci && npm run build                 # frontend
cd server && npm ci                     # backend
npm run migrate                         # apply new migrations
npm run build && pm2 restart afro-suite
```

## 6. Operations cheat-sheet

| Task | Command |
|---|---|
| Logs | `pm2 logs afro-suite` |
| Restart | `pm2 restart afro-suite` |
| Create another AFRO-TECH admin | edit `.env`, then `npm run seed` |
| Apply schema changes | add SQL in `server/migrations/`, run `npm run migrate` |
| DB backup | `pg_dump -U postgres afro_suite > backup.sql` |

## 7. Telegram bot + Mini App (optional but recommended)

Turns the platform into a Telegram-native assistant: push alerts for low stock, expiring medicine, unpaid fees and today's appointments, plus one-tap access to the full workspace as a Mini App.

**Setup:**

1. In Telegram, open **@BotFather** → `/newbot` → copy the token.
2. In BotFather: `/setmenubutton` → select your bot → URL = `https://yourdomain.com/app` → name "Open AFRO Suite".
3. Fill `server/.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:AA...
   TELEGRAM_BOT_USERNAME=yourbot
   TELEGRAM_WEBHOOK_URL=https://yourdomain.com/api/v1/telegram/webhook
   TELEGRAM_WEBHOOK_SECRET=<long random string>
   PUBLIC_URL=https://yourdomain.com
   ```
4. Register the webhook once (curl):
   ```bash
   curl "https://api.telegram.org/bot<token>/setWebhook?url=https://yourdomain.com/api/v1/telegram/webhook&secret_token=<secret>"
   ```
   (If `TELEGRAM_WEBHOOK_URL` is empty the server long-polls instead — fine for development.)
5. Restart: `pm2 restart afro-suite`

**How users connect:** web app → Settings → Telegram → *Generate link code* → tap the button (opens the bot) → the bot links the chat. From then on:
- Push alerts: low stock, batches expiring ≤30 days, fees due within 7 days, today's appointments (throttled to at most one message per category per 12h)
- Bot commands: `/today`, `/lowstock`, `/expiring`, `/shift`, `/help`, `/unlink`
- Mini App: opening the bot's menu button opens the real app **already signed in** (Telegram's signed `initData` is verified server-side — HMAC + freshness — no password needed)

Security notes: `initDataUnsafe` is never trusted; only the HMAC-verified `initData` with a 24h freshness window authenticates. The webhook validates Telegram's secret token header.

## 8. Multi-tenancy notes

- Every company registers itself at `/app/register` → gets an isolated workspace with a 45-day trial (`TRIAL_DAYS` in `.env`).
- Trials auto-expire; expired companies see a "contact AFRO-TECH" screen and lose API access.
- The AFRO-TECH admin panel (`/app`, signed in as the seeded admin) can grant free access, extend trials, or suspend any company.
- All business tables are scoped by `tenant_id`; every query is filtered by the caller's tenant from their JWT.
