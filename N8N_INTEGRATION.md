# n8n Integration Guide

This guide explains how the frontend integrates with your existing n8n backend.

## Webhook Endpoints

The frontend expects two webhook endpoints on your n8n instance:

### 1. Document Ingestion Webhook
**URL:** `POST https://n8n.sysmatixx.com/webhook/ingest`

**Request Body:**
```json
{
  "api_key": "unique-api-key-for-company",
  "source_name": "document.pdf",
  "label": "CV",
  "content": "text content of document...",
  "file_type": "application/pdf"
}
```

**Expected Response:**
```json
{
  "success": true,
  "chunk_count": 15,
  "message": "Document processed successfully"
}
```

**What This Does:**
1. Validates API key against Supabase companies table
2. Extracts text and chunks content
3. Generates embeddings (via HuggingFace)
4. Stores chunks in Supabase `document_chunks` table with embeddings
5. Returns chunk count to frontend

**n8n Workflow Steps:**
```
HTTP Request (trigger)
  ↓
Validate API Key (lookup in Supabase)
  ↓
Extract Text (based on file_type)
  ↓
Chunk Content (e.g., 512 character chunks)
  ↓
Generate Embeddings (HuggingFace API)
  ↓
Store in Supabase (document_chunks table)
  ↓
Return Response
```

---

### 2. Chat Webhook
**URL:** `POST https://n8n.sysmatixx.com/webhook/chat`

**Request Body:**
```json
{
  "api_key": "unique-api-key-for-company",
  "question": "What are your projects?",
  "memory_key": "3f2a…-visitor:8c17…-thread"
}
```

**`memory_key` — conversation scope for the memory node**

Wire your memory node's session key to `{{ $json.body.memory_key }}`.

It is `<visitorId>:<threadId>`:

- **visitorId** — a UUID minted once per browser and kept in localStorage. The
  public chat has no sign-in, so this is what "user" can mean here.
- **threadId** — a UUID per conversation, minted when the chat starts.

So the key is **constant across every turn of one conversation** (the memory
buffer accumulates) and **distinct for every other conversation and every other
visitor** (buffers never bleed into each other). It survives page reloads. It
does not survive the visitor clearing site data — but neither does their chat
history, so the two stay consistent.

Threads started before this field existed derive the same key on the fly, so
older conversations keep working.

**Expected Response:**
```json
{
  "answer": "Based on your documents, my projects include...",
  "has_context": true,
  "context": "relevant text chunks used for context"
}
```

**What This Does:**
1. Validates API key
2. Embeds the question
3. Searches Supabase for similar chunks (cosine similarity)
4. Retrieves top relevant chunks
5. Sends context to LLM (Groq)
6. Returns LLM response

**n8n Workflow Steps:**
```
HTTP Request (trigger)
  ↓
Validate API Key (lookup in Supabase)
  ↓
Get Company Name (for LLM prompt)
  ↓
Embed Question (HuggingFace API)
  ↓
Search Chunks (Supabase vector search)
  ↓
Check Context Found (similarity threshold)
  ↓
Call LLM (Groq with context)
  ↓
Return Response
```

---

## API Key Management

**API keys are stored in Supabase:**

```sql
SELECT api_key FROM companies WHERE id = 'company-uuid'
```

**Frontend Flow:**
1. User creates company → API key auto-generated
2. Document upload → Sends API key to n8n
3. n8n validates key against Supabase
4. User can view/regenerate key in admin dashboard
5. User can copy key to integrate with other services

**Your n8n Validation Query:**
```sql
SELECT id, name FROM companies WHERE api_key = $1 LIMIT 1
```

---

## Data Isolation (Multi-Tenancy)

All requests include an API key that scopes operations to a single company.

**Frontend Implementation:**
```typescript
// Get company by API key (in n8n)
const company = await supabase
  .from('companies')
  .select('*')
  .eq('api_key', api_key)
  .single()

// All subsequent operations scoped to this company_id
```

**Important:** Always validate the API key first and fail fast if invalid.

---

## Document Processing Details

### Input Content
Frontend sends raw file content as a string in the `content` field:
- Text files: Plain text
- PDFs: Extracted text (frontend uses fetch to get text)
- DOCX: Extracted text
- Images: OCR or alt text

### Chunking Strategy
Recommended approach:
- Chunk size: 512 characters (adjust based on your needs)
- Overlap: 50 characters (to preserve context)
- Split on sentences when possible

Example:
```javascript
// Pseudo-code
function chunkText(text, chunkSize = 512, overlap = 50) {
  const chunks = []
  for (let i = 0; i < text.length; i += chunkSize - overlap) {
    chunks.push(text.substring(i, i + chunkSize))
  }
  return chunks
}
```

### Embeddings
- Model: HuggingFace (e.g., `sentence-transformers/all-MiniLM-L6-v2`)
- Dimensions: 384 (as specified in schema.sql)
- Updated for each new document

**Supabase Storage:**
```sql
INSERT INTO document_chunks (
  company_id,
  document_id,
  content,
  embedding
) VALUES (
  $1,
  $2,
  $3,
  $4::vector
)
```

---

## Chat Processing Details

### Vector Search
Frontend searches for relevant chunks using cosine similarity:

```sql
SELECT 
  content,
  1 - (embedding <=> query_embedding) as similarity
FROM document_chunks
WHERE company_id = $1
ORDER BY similarity DESC
LIMIT 5
```

### Context Assembly
n8n should combine relevant chunks:

```
CONTEXT:
Chunk 1: "..."
Chunk 2: "..."
Chunk 3: "..."
```

### LLM Prompt
System prompt structure:
```
You are the support assistant for [COMPANY_NAME].
Answer the user's question using ONLY the context below.
If the answer is not in the context, say you don't have that information.
Do not mention other companies or use outside knowledge.

CONTEXT:
[RETRIEVED_CHUNKS]
```

### Response Format
- Plain conversational text (no markdown)
- No headers, bold, or special formatting
- Keep it concise (2-3 sentences unless detail requested)

---

## Error Handling

### Frontend Error Scenarios:

1. **Invalid API Key**
   - Response: 401 Unauthorized
   - Frontend Action: Show error to user

2. **File Too Large**
   - Response: 413 Payload Too Large
   - Frontend Action: Suggest splitting file

3. **Processing Timeout**
   - Response: 504 Gateway Timeout
   - Frontend Action: Retry after delay

4. **No Context Found**
   - Response: `{ "has_context": false }`
   - Frontend Action: Show "No relevant context" message

### Recommended Response Status Codes:
- **200:** Success
- **400:** Bad request (invalid parameters)
- **401:** Unauthorized (invalid API key)
- **413:** Payload too large
- **500:** Server error
- **503:** Service unavailable
- **504:** Timeout

---

## Example n8n Configuration

### Document Ingestion Workflow:

```
┌─ HTTP Trigger: POST /webhook/ingest
└─ Code (Validate API Key)
  └─ If valid:
      ├─ Supabase Query (Get company name)
      ├─ Code (Extract text from content)
      ├─ Code (Split into chunks)
      ├─ HuggingFace API (Generate embeddings)
      ├─ Supabase Insert (Save chunks)
      └─ HTTP Response (Success)
  └─ If invalid:
      └─ HTTP Response (Error)
```

### Chat Workflow:

```
┌─ HTTP Trigger: POST /webhook/chat
└─ Code (Validate API Key)
  └─ If valid:
      ├─ Supabase Query (Get company details)
      ├─ HuggingFace API (Embed question)
      ├─ Supabase Query (Vector search)
      ├─ Code (Assemble context)
      ├─ If context found:
      │   ├─ Groq API Call (Generate response)
      │   └─ HTTP Response (Answer + context)
      └─ If no context:
          └─ HTTP Response (No context message)
```

---

## Performance Considerations

### Document Ingestion:
- Processing time: 2-10 seconds depending on file size
- Chunking: O(n) where n = file size
- Embedding: API call per chunk (batch if possible)
- Storage: ~4KB per chunk (content + embedding)

### Chat:
- Vector search: <100ms with index
- LLM call: 2-5 seconds (depends on model)
- Total latency: ~3-6 seconds

**Optimization Tips:**
- Use vector indexes (ivfflat recommended)
- Batch embed requests if possible
- Cache company metadata
- Use connection pooling for Supabase

---

## Testing Checklist

### Document Upload Test:
```bash
curl -X POST https://n8n.sysmatixx.com/webhook/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "test-key",
    "source_name": "test.txt",
    "label": "Test",
    "content": "This is test content for embedding",
    "file_type": "text/plain"
  }'
```

Expected: 
```json
{
  "success": true,
  "chunk_count": 1
}
```

### Chat Test:
```bash
curl -X POST https://n8n.sysmatixx.com/webhook/chat \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "test-key",
    "question": "What is the test content?",
    "memory_key": "test-visitor:test-thread"
  }'
```

Re-send with the same `memory_key` to check the memory node is carrying context
between turns, and with a different one to check it is not.

Expected:
```json
{
  "answer": "Based on the test content, ...",
  "has_context": true
}
```

---

## Troubleshooting

### "Invalid API Key" Error
- Verify key exists in Supabase: `SELECT * FROM companies WHERE api_key = 'key'`
- Check key is being sent correctly by frontend
- Verify webhook is receiving the request

### "No embeddings generated"
- Check HuggingFace API key is valid
- Verify embeddings have correct dimension (384)
- Check content is not empty

### "Chat returns no context"
- Verify chunks exist in database: `SELECT COUNT(*) FROM document_chunks WHERE company_id = 'id'`
- Check vector similarity threshold (default: 0.3)
- Try lowering threshold to 0.1 for testing
- Verify question embedding is generated

### "Slow responses"
- Add vector index if not present
- Batch process embeddings
- Optimize chunk size
- Use connection pooling

---

## Frontend Code Reference

### Document Upload:
```typescript
// From app/documents/page.tsx
const result = await n8nClient.uploadDocument({
  api_key: company.api_key,
  source_name: file.name,
  label,
  content: fileContent,
  file_type: file.type,
})
```

### Chat Query:
```typescript
// From app/chat/[key]/chat-module.tsx
const response = await n8nClient.chat({
  api_key: chatKey,
  question,
  memory_key: memoryKeyOf(thread), // <visitorId>:<threadId>
})
```

The key itself is built in `lib/chat/storage.ts` (`buildMemoryKey`,
`memoryKeyOf`, `getVisitorId`).

Both implemented in `lib/n8n/client.ts`

---

## Security Notes

1. **API Keys:** Treated as secrets, stored server-side only
2. **Content:** Sent over HTTPS only
3. **Validation:** Always validate API key first
4. **Rate Limiting:** Consider adding per-key rate limits
5. **Audit:** Log all ingestion and chat requests
6. **Data:** Use company_id for all queries (tenant isolation)

---

## Widget Traffic (server-to-server)

Questions asked through an embedded website widget do **not** reach `/webhook/chat`
from the browser. They go to `/api/widget/chat` in this app, which authenticates
a signed session, then calls the same webhook server-side with the workspace key.
See `WIDGET.md` for why: a widget key sits in public HTML, so it must never be
the credential that also authorises ingest.

Two things change on the n8n side.

### 1. Shared secret (recommended)

When `N8N_SHARED_SECRET` is set, server-originated calls carry:

```
X-Widget-Secret: <the secret>
```

Add a first node to the chat workflow that rejects requests whose header does
not match. The webhook URL is guessable and publicly reachable — without this,
anyone who learns a workspace key can call it directly and bypass every rate
limit and origin check this app applies.

Keep it optional if you also want the public share link at `/chat/[key]` to keep
working, since that path still posts from the browser and sends no secret. To
require it everywhere, move the share link behind the same server route first.

### 2. New optional field: `site_id`

```json
{
  "api_key": "abc123...",
  "question": "What is the refund policy?",
  "memory_key": "visitor:thread",
  "site_id": "uuid-of-widget_sites-row"
}
```

Present only for widget traffic. Retrieval is still scoped by `api_key`, so the
workflow needs no change to work — it is there so per-site analytics do not need
a second lookup.

---

## Meeting Booking (n8n → this app)

Everything above is n8n receiving a call. This section is the other direction:
the booking workflow calls **into** this app to get a Google access token, then
writes its result back to Supabase.

The split is deliberate. The tenant's Google refresh token is a standing grant
over their calendar and their outbound mail, and it is encrypted with a key this
app holds. Copying it into an n8n credential store would put a per-tenant
credential somewhere with no revocation path and no audit trail — so the
workflow asks for a short-lived access token instead and never sees anything
longer-lived.

### 1. Get an access token

**URL:** `GET https://<your-app>/api/internal/google/token?company_id=<uuid>`

**Required header:**
```
X-Internal-Secret: <INTERNAL_API_SECRET>
```

This is the *only* authentication on the route — there is no session on a
server-to-server call. It is the mirror image of the `X-Widget-Secret` this app
sends you. If `INTERNAL_API_SECRET` is unset on the deployment, every request is
refused rather than let through, so an unconfigured environment fails closed.

**200 — connected:**
```json
{
  "connected": true,
  "access_token": "ya29.…",
  "calendar_id": "primary",
  "connected_email": "owner@acme.com"
}
```

**404 — no usable connection.** The workspace never connected Google, or the
grant has been revoked. Nothing to retry; this is the branch that should tell
the visitor booking is unavailable.
```json
{ "connected": false }
```

**Other statuses:**

| Status | Body | Meaning |
|---|---|---|
| `400` | `{"error":"invalid_request"}` | Missing or malformed `company_id`. |
| `401` | `{"error":"unauthorized"}` | Wrong secret, or none sent. |
| `502` | `{"connected":false,"error":"refresh_failed"}` | A connection exists but Google would not renew it right now. Worth retrying — unlike the 404. |
| `500` | `{"connected":false,"error":"internal_error"}` | Unexpected. Logged in full on the app side. |

Branch on `connected` rather than on the status code and both success and the
"not set up" case read from one field.

**Notes for the workflow:**

- **Do not cache the token.** The app already refreshes it 120s ahead of expiry
  and persists the result, so calling this per booking is cheap and always
  fresh. Caching it in a workflow variable reintroduces the expiry problem the
  endpoint exists to remove.
- **Use it as a bearer token:** `Authorization: Bearer <access_token>` against
  `https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events` and
  `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`.
- **Granted scopes are `calendar.events` and `gmail.send` only.** The token
  cannot read the mailbox, list calendars, or delete one. If a call 403s, that
  is why.
- **`calendar_id` is authoritative** — use the returned value rather than
  hardcoding `primary`, or a tenant who points bookings at a shared calendar
  will have them land in the wrong place.
- Ask for a Meet link with `conferenceData` plus `conferenceDataVersion=1` on
  the insert; the created event returns `hangoutLink`, which is what belongs in
  `meetings.meet_link`.

**Resolving `company_id`:** the chat workflow is keyed on `api_key`, this
endpoint on the workspace UUID.
```sql
SELECT id FROM companies WHERE api_key = $1 LIMIT 1
```

**Test:**
```bash
curl -i "https://<your-app>/api/internal/google/token?company_id=<uuid>" \
  -H "X-Internal-Secret: <INTERNAL_API_SECRET>"
```
Expect `401` with the header removed, `400` with a malformed `company_id`, and
`404 {"connected": false}` for a workspace that has not connected Google.

---

### 2. Read the availability

```sql
SELECT timezone, weekly_hours, slot_minutes, buffer_minutes, minimum_notice_minutes
FROM availability_schedules
WHERE company_id = $1
```

```json
{
  "timezone": "Asia/Kolkata",
  "weekly_hours": {
    "mon": [{ "start": "09:00", "end": "12:30" }, { "start": "13:30", "end": "17:00" }],
    "tue": [{ "start": "09:00", "end": "17:00" }],
    "wed": [], "thu": [], "fri": [], "sat": [], "sun": []
  },
  "slot_minutes": 30,
  "buffer_minutes": 0,
  "minimum_notice_minutes": 120
}
```

**The one thing to get right:** `start` and `end` are **wall-clock times in
`timezone`**, not offsets and not instants. Build each candidate slot by
combining a date with the wall-clock time *in that zone* — do not compute an
offset once and add it to every date, because that breaks on both sides of a
daylight-saving change. In n8n, Luxon is already available:

```javascript
DateTime.fromISO(`${date}T${start}`, { zone: schedule.timezone })
```

How to read the rest:

| Field | Meaning |
|---|---|
| `weekly_hours` | Keys are always `mon`…`sun`, always present. An empty array is a day off. Several ranges in a day means a gap between them (a lunch break) — they never overlap and arrive sorted by start. |
| `slot_minutes` | Cut each range into slots of this length, **each range independently**. Two adjacent 45-minute ranges do not combine into one 60-minute slot. |
| `buffer_minutes` | Advance by `slot_minutes + buffer_minutes` after placing a slot, but do not require the buffer to fit before the range ends: a 60-minute range with a 30-minute meeting and a 15-minute buffer yields one slot, not zero. |
| `minimum_notice_minutes` | Discard any slot starting sooner than this from now. |

A row always exists in practice — the console seeds weekdays 09:00–17:00 on
first visit — but treat a missing row as "no availability configured" rather
than as "available at all times".

**This is what may be *offered*, not what is free.** Whether a slot is actually
open still has to be checked against the calendar, which is what the
`calendar.freebusy` scope on the access token is for.

---

### 3. Read the confirmation template

```sql
SELECT subject, body_html
FROM email_templates
WHERE company_id = $1 AND template_key = 'meeting_confirmation'
```

Substitute `{{token}}` — with any inner whitespace, e.g. `{{ lead_name }}` — in
**both** the subject and the body:

| Variable | Value |
|---|---|
| `{{lead_name}}` | Lead's name |
| `{{lead_email}}` | Lead's email |
| `{{meeting_date}}` | Date, in the lead's timezone |
| `{{meeting_time}}` | Time, in the lead's timezone |
| `{{meet_link}}` | The event's `hangoutLink`; empty for in-person |
| `{{company_name}}` | `companies.name` |

Leave an unrecognised token exactly as written rather than replacing it with an
empty string. The console warns the owner about tokens it does not recognise, and
that warning is only useful if the sender agrees with it. `lib/email/templates.ts`
is the authoritative list and the reference implementation of the substitution.

Send the mail **from the connected mailbox** (`connected_email`) — sending from
anywhere else is the thing this integration exists to avoid.

A row always exists in practice: the app seeds the default at workspace creation
and again on first visit to Admin → Email Templates. Falling back to a plain
message if the query returns nothing is still worth doing.

---

### 4. Record the booking

Insert with the **service-role key** — `meetings` has an RLS policy for the
owner's own session only, and your workflow has no session.

```sql
INSERT INTO meetings (
  company_id, memory_key, lead_name, lead_email,
  starts_at, ends_at, timezone,
  is_online, meet_link, calendar_event_id, status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'booked')
```

| Column | Notes |
|---|---|
| `memory_key` | Pass through the same `<visitor>:<thread>` value the chat request carried, so a booking can be traced to the conversation that produced it. |
| `starts_at` / `ends_at` | `timestamptz` — send an ISO 8601 string **with an offset**. A naive local time will be read as UTC. |
| `timezone` | The IANA name (`Europe/London`), not an offset — a record of the zone the booking was made in. Send the current name (`Asia/Kolkata`, not `IST` or `Asia/Calcutta`); the console no longer renders rows in this zone, but a mix of aliases here makes the column useless for anything later. It is `starts_at` that has to be right. |
| `is_online` | `false` for in-person; leave `meet_link` null. |
| `calendar_event_id` | Google's event id, so a later reschedule can find the event. |
| `status` | **CHECK constraint:** `booked`, `cancelled`, or `completed`. Anything else is rejected by the database rather than silently stored. |

Cancelling later is an `UPDATE … SET status = 'cancelled'`, not a delete — the
console shows cancellations, and a deleted row just looks like a booking that
never happened.

---

### 5. Deployment checklist

On the app side, in the environment (see `.env.example`):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`,
`INTERNAL_API_SECRET`, and `GOOGLE_REDIRECT_URI` when the default
(`<NEXT_PUBLIC_APP_URL>/api/auth/google/callback`) is not what the Google Cloud
console has.

Also run `scripts/meetings-schema.sql`, `scripts/display-timezone.sql` and
`scripts/availability-schema.sql`, and note that `calendar.events` and
`gmail.send` are both sensitive scopes — Google has to verify the OAuth consent
screen before anyone outside the test-user list can connect.

---

## Contact & Support

For issues with the frontend ↔ n8n integration:
1. Check that webhooks are accessible
2. Verify response format matches expected schema
3. Check browser console for frontend errors
4. Check n8n workflow logs for processing errors
5. Verify Supabase connection and data

Good luck with your RAG chatbot! 🚀
