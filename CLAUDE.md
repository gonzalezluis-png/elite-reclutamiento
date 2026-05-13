# Elite Reclutamiento

CRM de reclutamiento. Leads de candidatos, pipeline de webinar → entrevista → contratación, Ana (IA de WhatsApp), mensajería WA/SMS, calendario de entrevistas.

**URL producción:** https://crm.grupoelite.com.mx (o dominio similar)  
**Backend Railway:** elite-reclutamiento-production.up.railway.app  
**Firestore:** proyecto Firebase de elite-reclutamiento  
**Servidor:** `/server/` (Node.js + Express en Railway)

## Lo que NO pertenece a este proyecto
- Tableros de ventas por estado (Florida, Dallas, Austin, etc.)
- Créditos, usuarios GEW, kv_store de Supabase vpwbczzmonboirjckpmy

Esas cosas pertenecen al proyecto **GrupoEliteWork-CRM** (`/Users/luisgonzalez/desarrollador/GrupoEliteWork-CRM`).

## Archivos clave
- `init.js` — arranque de app, sync de leads cada 15s
- `messaging.js` — vista de mensajería WA, Ana, templates
- `utils.js` — `dedupMsgs`, helpers
- `index.html` — UI principal
- `server/index.js` — servidor principal
- `server/interviews.js` — entrevistas, recordatorios
- `server/ana.js` — lógica de IA Ana
