# Multi-Tenant RAG Chatbot Frontend - Setup Guide

This is a complete Next.js 16 frontend for a multi-tenant RAG (Retrieval-Augmented Generation) chatbot system integrated with n8n and Supabase.

## Architecture Overview

### Components
- **Frontend**: Next.js 16 with React 19, TypeScript, Tailwind CSS
- **Backend**: n8n webhook API at `https://n8n.sysmatixx.com/webhook`
- **Database**: Supabase PostgreSQL with pgvector for embeddings
- **Authentication**: Supabase Auth (Email/Password)

### Key Features
- ✅ Multi-tenant company isolation
- ✅ Document upload & processing via n8n
- ✅ Context-aware chatbot with conversation history
- ✅ Admin dashboard with analytics
- ✅ API key management
- ✅ Row-level security (RLS) for data isolation
- ✅ Real-time chat with streaming responses

## Prerequisites

1. **Supabase Project**: Create a Supabase project and get your credentials
   - Project URL (e.g., `https://xxxxx.supabase.co`)
   - Anon Key (public API key)

2. **n8n Instance**: Your n8n backend at `https://n8n.sysmatixx.com/webhook`
   - Ensure webhook endpoints are configured:
     - `/webhook/ingest` - Document ingestion
     - `/webhook/chat` - Chat endpoint

## Environment Setup

1. **Set Environment Variables** in your `.env.local`:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here

# Optional: For local development
NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL=http://localhost:3000/auth/callback
```

2. **Database Schema Setup**:

Execute the SQL in `/scripts/schema.sql` in your Supabase SQL Editor:
- Creates all necessary tables
- Sets up RLS policies for multi-tenant isolation
- Creates indexes for performance
- Enables pgvector extension

Steps:
1. Go to Supabase Dashboard → SQL Editor
2. New Query
3. Copy and paste contents of `/scripts/schema.sql`
4. Run Query

## Project Structure

```
app/
├── page.tsx                          # Dashboard home
├── layout.tsx                        # Root layout
├── auth/
│   ├── login/page.tsx               # Login form
│   ├── sign-up/page.tsx             # Registration
│   ├── callback/route.ts            # OAuth callback
│   └── error/page.tsx               # Auth errors
├── dashboard/
│   └── company/create/page.tsx       # Create company
├── documents/
│   └── page.tsx                     # Document management
├── chatbot/
│   └── page.tsx                     # Chat interface
└── admin/
    └── page.tsx                     # Admin dashboard

components/
├── ui/                              # shadcn components
│   ├── button.tsx
│   ├── input.tsx
│   ├── card.tsx
│   └── label.tsx

lib/
├── supabase/
│   ├── client.ts                    # Browser Supabase client
│   ├── server.ts                    # Server Supabase client
│   └── proxy.ts                     # Auth proxy for cookies
└── n8n/
    └── client.ts                    # n8n webhook client

scripts/
└── schema.sql                       # Database schema setup

proxy.ts                        # Auth proxy (Next 16 middleware)
tailwind.config.ts                   # Tailwind config
```

## User Flows

### 1. Registration & Company Setup
1. User signs up with email/password
2. User creates a company (name + auto-generated API key)
3. API key is stored in Supabase
4. User redirected to dashboard

### 2. Document Upload
1. User selects company from dropdown
2. User uploads document (PDF, DOCX, TXT, images)
3. Assigns a label (e.g., "CV", "Invoice", "Document")
4. Frontend sends to n8n `/webhook/ingest` with:
   - `api_key`: Company's API key
   - `source_name`: Original filename
   - `label`: User-provided label
   - `content`: File content
   - `file_type`: MIME type
5. n8n processes document:
   - Extracts text
   - Chunks content
   - Generates embeddings (via HuggingFace)
   - Stores in Supabase `document_chunks` table
6. Metadata stored in `documents` table

### 3. Chat Interface
1. User opens chat for a company
2. Conversation is created (if first time)
3. User enters question
4. Frontend sends to n8n `/webhook/chat` with:
   - `api_key`: Company's API key
   - `question`: User question
5. n8n processes:
   - Embeds question
   - Searches Supabase for relevant chunks (cosine similarity)
   - Sends context to Groq LLM
   - LLM generates response
6. Response stored in `messages` table
7. Chat history persists across sessions

### 4. Admin Dashboard
- View company statistics (documents, chunks, conversations, messages)
- Copy/regenerate API keys
- Delete company and all associated data

## Database Schema

### companies
```sql
id (UUID) - Primary key
name (TEXT) - Company name
api_key (TEXT) - Unique API key for n8n integration
owner_id (UUID) - Reference to auth.users
created_at, updated_at (TIMESTAMP)
```

### documents
```sql
id (UUID) - Primary key
company_id (UUID) - Foreign key to companies
label (TEXT) - User-provided label
source_name (TEXT) - Original filename
preview (TEXT) - First 200 characters
chunk_count (INT) - Number of chunks
created_at, updated_at (TIMESTAMP)
```

### document_chunks
```sql
id (UUID) - Primary key
company_id (UUID) - For tenant scoping
document_id (UUID) - Reference to documents
content (TEXT) - Actual text chunk
embedding (vector) - pgvector embedding (384 dimensions)
created_at (TIMESTAMP)
```

### conversations
```sql
id (UUID) - Primary key
company_id (UUID) - For tenant scoping
user_id (UUID) - Reference to auth.users
created_at (TIMESTAMP)
```

### messages
```sql
id (UUID) - Primary key
conversation_id (UUID) - Reference to conversations
user_id (UUID) - Reference to auth.users
role (TEXT) - 'user' or 'assistant'
content (TEXT) - Message content
created_at (TIMESTAMP)
```

## Security Considerations

### Row Level Security (RLS)
- All tables have RLS enabled
- Users can only see their own companies
- Companies can only see their own documents/chunks
- Conversations isolated by user and company
- `auth.uid()` used in all policies

### API Key Security
- API keys are stored server-side in Supabase
- Used for n8n integration only
- Can be regenerated
- Not exposed to frontend (except when viewing in admin)

### Authentication
- Email/password via Supabase Auth
- Cookies managed automatically by `@supabase/ssr`
- Middleware checks auth for protected routes
- Automatic session refresh via proxy

## n8n Integration

The frontend sends requests to n8n webhooks:

### Document Ingestion (`POST /webhook/ingest`)
```json
{
  "api_key": "company_api_key",
  "source_name": "document.pdf",
  "label": "CV",
  "content": "text content here...",
  "file_type": "application/pdf"
}
```

Expected response:
```json
{
  "success": true,
  "chunk_count": 15
}
```

### Chat (`POST /webhook/chat`)
```json
{
  "api_key": "company_api_key",
  "question": "What are the key projects?"
}
```

Expected response:
```json
{
  "answer": "Based on your documents...",
  "has_context": true,
  "context": "relevant chunks..."
}
```

## Deployment

### Vercel (Recommended)
1. Push to GitHub
2. Connect repo to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy

### Other Platforms
1. Install dependencies: `pnpm install`
2. Build: `pnpm build`
3. Start: `pnpm start`
4. Set environment variables before starting

## Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Open http://localhost:3000

# Build for production
pnpm build

# Type checking
pnpm tsc --noEmit

# Linting
pnpm lint
```

## Troubleshooting

### "Module not found" errors
- Run `pnpm install`
- Check all shadcn components are installed
- Verify import paths

### Supabase connection issues
- Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Check RLS policies are correctly set up
- Verify user is authenticated

### Chat not working
- Verify n8n webhooks are accessible
- Check API key is correct
- Verify documents have been uploaded and processed
- Check n8n workflow logs

### Documents not uploading
- Verify file size (should be < 10MB typically)
- Check file format is supported
- Verify company has valid API key
- Check n8n `/webhook/ingest` is working

## API Documentation

See `lib/n8n/client.ts` for the N8nClient class with methods:
- `uploadDocument()` - Send document to n8n
- `chat()` - Send chat query to n8n

## Performance Optimization

1. **Vector Search**: Indexed with ivfflat for fast similarity search
2. **RLS**: Reduces query scope to user's data
3. **Caching**: Use SWR hooks for client-side caching
4. **Pagination**: Implement for large document lists
5. **Lazy Loading**: Chat messages loaded on scroll

## Future Enhancements

- [ ] Batch document uploads
- [ ] Advanced analytics dashboard
- [ ] Team collaboration (multiple users per company)
- [ ] Custom LLM model selection
- [ ] Webhook logs and monitoring
- [ ] Document version history
- [ ] Export conversation history
- [ ] Multi-language support

## Support

For issues or questions:
1. Check the database schema is correctly set up
2. Verify environment variables are correct
3. Check n8n workflow status
4. Review browser console for errors
5. Check Supabase logs for RLS policy violations

## License

MIT
