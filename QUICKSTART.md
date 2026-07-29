# Quick Start Guide

Get your RAG Chatbot frontend up and running in 5 minutes.

## 1. Environment Setup

Create a `.env.local` file in the project root:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# For local development (optional, auto-detected in preview)
NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL=http://localhost:3000/auth/callback
```

Get these values from your Supabase project settings:
1. Go to Supabase Dashboard
2. Click on your project
3. Settings → API → Project URL and anon key

## 2. Database Schema

Run the schema setup in Supabase SQL Editor:

1. Open Supabase Dashboard
2. Go to SQL Editor
3. Create new query
4. Paste contents of `/scripts/schema.sql`
5. Click "Run"

This creates:
- companies table
- documents table
- document_chunks table
- conversations table
- messages table
- All RLS policies
- Indexes for performance

## 3. Install & Run

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Visit http://localhost:3000
```

## 4. Create Your First Company

1. **Sign Up**: Go to http://localhost:3000/auth/sign-up
   - Enter email and password
   - Click "Sign Up"
   - Confirm email (check inbox or use Supabase email confirmation)

2. **Login**: Go to http://localhost:3000/auth/login
   - Enter credentials

3. **Create Company**: On dashboard, click "Create Company"
   - Enter company name
   - Click "Create Company"
   - API key is auto-generated

## 5. Upload Documents

1. Click "Manage Documents" on your company card
2. Select a file (PDF, DOCX, TXT, images)
3. Enter a label (CV, Invoice, Document, etc.)
4. Click "Upload Document"
5. Wait for n8n processing to complete

**Important**: Make sure your n8n instance is running and webhooks are accessible:
- `/webhook/ingest` - Document processing
- `/webhook/chat` - Chat queries

## 6. Chat with Your Documents

1. Click "Open Chat" on your company card
2. Ask questions about your uploaded documents
3. Bot will search relevant chunks and respond

Example queries:
- "What projects have you worked on?"
- "Summarize your experience"
- "What are your key skills?"

## 7. Admin Dashboard

1. Click "Admin Dashboard" in company details
2. View statistics:
   - Total documents
   - Text chunks
   - Conversations
   - Messages
3. Manage API keys
4. View company information

## Common Issues

### "Unauthorized" on login
- Check email is confirmed in Supabase
- Verify Supabase credentials in `.env.local`
- Check RLS policies are enabled (check schema.sql ran successfully)

### Documents not uploading
- Verify n8n webhook URL is correct: `https://n8n.sysmatixx.com/webhook/ingest`
- Check file is < 10MB
- Check file format is supported
- Verify API key is correct (from admin dashboard)

### Chat not responding
- Verify n8n chat webhook: `https://n8n.sysmatixx.com/webhook/chat`
- Ensure documents have been uploaded
- Check that n8n workflow is running
- Verify company has API key

### Supabase connection errors
- Verify `NEXT_PUBLIC_SUPABASE_URL` format (should end in `.supabase.co`)
- Check anon key is correct (doesn't have extra spaces)
- Restart dev server: `pnpm dev`

## File Structure

Key files to understand:

```
app/page.tsx                    # Main dashboard
app/auth/login/page.tsx         # Login form
app/auth/sign-up/page.tsx       # Registration
app/documents/page.tsx          # Document management
app/chat/[key]/page.tsx         # Public chat module (no login)
app/admin/page.tsx              # Admin dashboard

lib/supabase/client.ts          # Supabase browser client
lib/n8n/client.ts               # n8n API client

scripts/schema.sql              # Database setup
```

## Next Steps

1. **Customize Branding**
   - Update colors in `tailwind.config.ts`
   - Update company name in `app/layout.tsx`
   - Add logo to `/public/`

2. **Deploy to Vercel**
   - Push to GitHub
   - Connect repo to Vercel
   - Set environment variables
   - Deploy

3. **Add Features**
   - Batch upload
   - Team collaboration
   - Custom LLM models
   - Export chat history

## Testing Checklist

- [ ] Can sign up with email
- [ ] Can login with credentials
- [ ] Can create company
- [ ] Can upload document
- [ ] Can see document in list
- [ ] Can chat with bot
- [ ] Can view admin dashboard
- [ ] Can copy API key
- [ ] Can delete document
- [ ] Can delete company

## Support

Refer to `SETUP.md` for detailed documentation.

For issues:
1. Check browser console for errors (F12)
2. Check terminal output for server errors
3. Verify Supabase schema setup
4. Verify environment variables
5. Check n8n webhook logs
