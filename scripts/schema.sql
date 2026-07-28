-- Enable Vector extension for pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Companies table (multi-tenant isolation)
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  api_key text UNIQUE NOT NULL,
  created_at timestamp WITH TIME ZONE DEFAULT now(),
  updated_at timestamp WITH TIME ZONE DEFAULT now(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Documents metadata
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label text,
  source_name text NOT NULL,
  preview text,
  chunk_count integer DEFAULT 0,
  created_at timestamp WITH TIME ZONE DEFAULT now(),
  updated_at timestamp WITH TIME ZONE DEFAULT now()
);

-- Document chunks with embeddings
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(384),
  created_at timestamp WITH TIME ZONE DEFAULT now()
);

-- Chat conversations
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp WITH TIME ZONE DEFAULT now()
);

-- Chat messages
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamp WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Companies RLS Policies
CREATE POLICY "companies_select_own" ON public.companies 
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "companies_insert_own" ON public.companies 
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "companies_update_own" ON public.companies 
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "companies_delete_own" ON public.companies 
  FOR DELETE USING (auth.uid() = owner_id);

-- Documents RLS Policies (users can see docs for their company)
CREATE POLICY "documents_select_company" ON public.documents 
  FOR SELECT USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

CREATE POLICY "documents_insert_company" ON public.documents 
  FOR INSERT WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

CREATE POLICY "documents_update_company" ON public.documents 
  FOR UPDATE USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

CREATE POLICY "documents_delete_company" ON public.documents 
  FOR DELETE USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

-- Document chunks RLS Policies
CREATE POLICY "chunks_select_company" ON public.document_chunks 
  FOR SELECT USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

CREATE POLICY "chunks_insert_company" ON public.document_chunks 
  FOR INSERT WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

CREATE POLICY "chunks_delete_company" ON public.document_chunks 
  FOR DELETE USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

-- Conversations RLS Policies
CREATE POLICY "conversations_select_user" ON public.conversations 
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "conversations_insert_user" ON public.conversations 
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Messages RLS Policies
CREATE POLICY "messages_select_own" ON public.messages 
  FOR SELECT USING (
    conversation_id IN (
      SELECT id FROM public.conversations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "messages_insert_own" ON public.messages 
  FOR INSERT WITH CHECK (
    conversation_id IN (
      SELECT id FROM public.conversations WHERE user_id = auth.uid()
    )
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_company_id ON public.documents(company_id);
CREATE INDEX IF NOT EXISTS idx_chunks_company_id ON public.document_chunks(company_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON public.document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_conversations_company_id ON public.conversations(company_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_companies_owner_id ON public.companies(owner_id);

-- Create vector index for similarity search
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON public.document_chunks 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
