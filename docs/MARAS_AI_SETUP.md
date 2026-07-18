# MARAS AI — Setup and Monitoring (PR #128)

MARAS AI is the internal AI assistant for **eTIR by MARAS**, available only
inside the Admin Panel (the ✨ MARAS AI drawer, super/operation admins).
It reads and analyzes eTIR data and prepares drafts and suggestions — it
never sends messages, changes statuses, edits accounting values, or
modifies any record.

## Enabling MARAS AI

1. Set these environment variables on the **server** (Cloud Run env vars in
   production, `.env` locally — never in source code, never committed):

   ```
   OPENAI_API_KEY=sk-...        # server-side only, never reaches a browser
   OPENAI_MODEL=                # optional; empty = default from marasAiCore.ts
   MARAS_AI_ENABLED=true        # master switch, must literally be "true"
   ```

2. Restart the server. The drawer's Send now talks to
   `POST /api/admin/maras-ai/chat` (full admins only).

If either variable is missing, the endpoint answers `503
MARAS_AI_UNAVAILABLE` with a clear message, the drawer shows it, and
nothing else in the Admin application is affected. A provider outage
answers `502 MARAS_AI_UPSTREAM` — MARAS AI never fabricates a response.

**Never commit a real API key.** `.env` is gitignored; `.env.example`
carries empty placeholders only.

## What gets sent to OpenAI

Only the employee's message, a capped slice of the current drawer
conversation, and a **whitelist-built** context digest (shipment
number/status/route/driver/dates/documents list, and — for the Super Admin
only — the technical-alert digest). Session tokens, password hashes, share
tokens, storage credentials, and push tokens are never read by the context
builders (`src/lib/marasAiCore.ts`), so they cannot leak into a prompt.

## Super Admin monitoring alerts

The server keeps a small **in-process, bounded (400 groups) monitoring
store** (`src/lib/monitoringStore.ts`) — deliberately not a new database
or external platform; it resets on restart like a process log. A response
observer records every `/api` request that fails with a 5xx or exceeds the
slow threshold (3s), grouping repeats into one event with a rising count
(no alert spam). The Admin frontend can also report repeated client-side
errors via `POST /api/admin/monitoring/frontend-error`.

- `GET /api/admin/maras-ai/alerts` — **Super Admin only** — returns the
  grouped technical alerts (title, severity low/medium/high/critical,
  time, affected area, explanation, occurrence count, suggested action).
- Operation and accounts admins can use MARAS AI but receive **no**
  technical telemetry: the monitoring digest is added to the AI context
  only for Super Admin sessions, and the alerts route rejects everyone
  else with 403.
- Ask MARAS AI (as Super Admin): “What application errors happened
  today?”, “Is any Admin page slow?”, “What should be improved?” — it
  answers from the alert digest and gives advice; it never changes code
  or data.
