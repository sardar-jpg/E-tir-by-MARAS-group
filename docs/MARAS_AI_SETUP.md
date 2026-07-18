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

## System awareness

Before any prompt reaches OpenAI, the server inspects the request
(`src/lib/marasAiIntents.ts`): "Which shipments are delayed?" triggers a
shipment-data collection, "Which drivers have the most delayed
deliveries?" collects drivers + shipments, "Review monitoring alerts"
loads the stored monitoring events (Super Admin only), and so on. The
collected records are reduced to compact whitelist digests and attached
as CONTEXT DATA — so MARAS AI answers from real backend data instead of
asking the employee to paste information. A question that needs no
system data (general knowledge) is sent without any.

Every reply carries an honest **response-source indicator**, shown under
the answer in the drawer:

- **System Data + AI Analysis** — the model analyzed backend data.
- **AI Analysis** — general knowledge, no backend data attached.
- **System Data** — produced from backend data without the model.

The indicator is derived server-side from what actually happened — never
guessed or faked.

## What gets sent to OpenAI

Only the employee's message, the stored conversation's capped history,
and **whitelist-built** context digests (shipment number/status/route/
driver/dates/documents list, aggregate driver/accounting/operations
digests, and — for the Super Admin only — the technical-alert digest).
Session tokens, password hashes, share tokens, storage credentials, and
push tokens are never read by the context builders
(`src/lib/marasAiCore.ts`, `src/lib/marasAiIntents.ts`), so they cannot
leak into a prompt.

## Conversation history

MARAS AI conversations persist per admin in the `marasAiConversations`
collection (same persistence layer as every other collection). Each
admin — Super Admin included — can only ever list, reopen, continue, or
delete their **own** conversations; the server checks ownership on every
route. Titles auto-derive from the opening message; the drawer offers
**New Conversation** and per-conversation delete. Stored threads are
capped (newest 60 messages).

## Super Admin monitoring alerts

Monitoring events are grouped in a bounded working set (400 groups,
`src/lib/monitoringStore.ts`) and **persisted** to the existing project
database (`monitoringEvents` collection — one document per group, written
through the same Firestore/memory-fallback wrappers as everything else;
no new database, no external platform). On restart the server hydrates
the stored groups back, so monitoring history **survives restarts**.
Events older than **30 days** are pruned automatically (working set and
documents both).

A response observer records every `/api` request that fails with a 5xx
or exceeds the slow threshold (3s), grouping repeats into one event with
a rising count (no alert spam). The Admin frontend can also report
repeated client-side errors via `POST /api/admin/monitoring/frontend-error`.

- `GET /api/admin/maras-ai/alerts` — **Super Admin only** — returns the
  grouped technical alerts (title, severity low/medium/high/critical,
  time, affected area, explanation, occurrence count, suggested action).
- Operation and accounts admins can use MARAS AI but receive **no**
  technical telemetry: the monitoring digest is added to the AI context
  only for Super Admin sessions, and the alerts route rejects everyone
  else with 403.
- Ask MARAS AI (as Super Admin): “What application errors happened
  today?”, “Is any Admin page slow?”, “What should be improved?” — it
  answers from the stored alert digest and gives advice; it never changes
  code or data.
