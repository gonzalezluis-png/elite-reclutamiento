# Restaurar el CRM completo de Elite Reclutamiento

Este branch (`crm-completo-backup`) contiene el CRM completo antes de reducirlo a webinar-only.

## ¿Qué incluye?

- CRM completo con Kanban de candidatos, pipeline, leads
- IA Ana (WhatsApp Cloud API + Instagram + Messenger)
- Mensajería WA/SMS (Twilio + Meta)
- Calendario de entrevistas
- Panel de configuración, usuarios, automations
- Todos los módulos JS del frontend

## Cómo restaurar

### 1. Cambiar al branch de backup
```bash
git fetch origin
git checkout crm-completo-backup
```

### 2. Base de datos (Supabase)
- Proyecto: `tffwtmrvlnblzyjwesze.supabase.co`
- Tablas necesarias: `leads`, `wa_messages`, `sessions`, `users`, `config`,
  `webhook_log`, `escalations`, `team_messages`, `call_log`, `interviews`, `notifications`
- Si las tablas fueron borradas, restaurarlas con `server/supabase-schema.sql`

### 3. Variables de entorno Railway
Volver a agregar estas variables en el dashboard de Railway:

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | `https://tffwtmrvlnblzyjwesze.supabase.co` |
| `SUPABASE_KEY` | La service role key de Supabase |
| `RESEND_API_KEY` | API key de Resend (correos) |
| `EMAIL_FROM` | `webinar@grupoelitework.com` |
| `ANTHROPIC_API_KEY` | API key de Claude (IA Ana) |
| `META_WA_TOKEN` | Token de WhatsApp Cloud API |
| `META_WA_PHONE_ID` | Phone ID de Meta |
| `META_IG_ACCESS_TOKEN` | Token de Instagram |
| `META_PAGE_ACCESS_TOKEN` | Token de Messenger |
| `META_APP_SECRET_WA` | App secret WA para verificar webhooks |
| `META_APP_SECRET_IG` | App secret IG para verificar webhooks |
| `META_VERIFY_TOKEN` | `grupoelite2026` |
| `WEBINAR_URL` | `https://crm.grupoelitework.com/webinar.html` |

### 4. Deploy
```bash
# Railway (backend)
cd server && git push origin crm-completo-backup

# Vercel (frontend) — deployar desde el dashboard de Vercel
# o con Vercel CLI:
vercel --prod
```

### 5. Webhooks Meta
Reconectar los webhooks en Meta for Developers apuntando al URL de Railway.

## Archivos clave
- `server/server.js` — servidor principal (Express)
- `server/pipeline.js` — pipeline WA, moveLeadToWebinar, sendWebinarEmail
- `server/meta.js` — webhooks Meta (WA, IG, Messenger)
- `server/ai.js` — IA Ana (Claude)
- `server/db.js` — módulo Supabase
- `index.html` — CRM frontend completo
