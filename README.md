# PrimeTime Backend

Serverless backend pro naplánované Trello komentáře.

## Stack
- **Vercel** Edge Functions — API endpointy
- **Upstash QStash** — scheduling HTTP requestů
- **Upstash Redis** — uložení tokenů + metadata jobů

## Endpointy

| Endpoint | Volá | Popis |
|----------|------|-------|
| `POST /api/auth` | Power-Up | Uloží OAuth token člena |
| `POST /api/schedule` | Power-Up | Naplánuje komentář přes QStash |
| `POST /api/send-comment` | QStash | Odešle komentář v daný čas |
| `POST /api/revoke` | Power-Up | Odvolá token a zruší čekající joby |

## Deploy

### 1. Naklonuj repo a nainstaluj závislosti
```bash
git clone https://github.com/tvuj-ucet/primetime-backend
cd primetime-backend
npm install
```

### 2. Vygeneruj šifrovací klíč
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Zkopíruj výstup — to je tvůj `TOKEN_ENCRYPTION_KEY`.

### 3. Nastav environment variables na Vercel
V Vercel dashboardu → Settings → Environment Variables přidej:

```
TRELLO_API_KEY              = (z trello.com/power-ups/admin)
TRELLO_OAUTH_SECRET         = (z trello.com/power-ups/admin)
UPSTASH_REDIS_REST_URL      = (z Upstash console → Redis → primetime-store)
UPSTASH_REDIS_REST_TOKEN    = (z Upstash console → Redis → primetime-store)
QSTASH_TOKEN                = (z Upstash console → QStash)
QSTASH_CURRENT_SIGNING_KEY  = (z Upstash console → QStash)
QSTASH_NEXT_SIGNING_KEY     = (z Upstash console → QStash)
TOKEN_ENCRYPTION_KEY        = (vygenerovaný klíč z kroku 2)
BACKEND_URL                 = https://primetime-backend.vercel.app
ALLOWED_ORIGIN              = https://praceburian-debug.github.io
```

### 4. Deploy
```bash
npm i -g vercel
vercel --prod
```

Po deployi zkopíruj URL (např. `https://primetime-backend-xyz.vercel.app`) a:
- Nastav ji jako `BACKEND_URL` v Vercel env vars
- Přidej ji do Trello Power-Up Allowed Origins

## Redis key schéma
```
token:{memberId}         → AES-256-GCM zašifrovaný OAuth token (TTL 1 rok)
scheduled:{jobId}        → JSON metadata jobu (TTL sendAt + 48h)
member:{memberId}:jobs   → SET jobIds čekajících jobů člena
```
