-- =============================================================================
-- Multi-tenant RAG Chatbot — full schema reset
-- =============================================================================
-- DESTRUCTIVE: this drops the five application tables and everything in them.
-- Auth users (auth.users) are NOT touched, so existing logins keep working.
--
-- Run the whole file in the Supabase SQL Editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run).
--
-- This file drops before it creates on purpose. The previous version used
-- CREATE TABLE IF NOT EXISTS, which silently did nothing when a table of the
-- same name already existed with a different shape — leaving `companies`
-- without `owner_id` and aborting every statement after it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- 2. Drop existing objects (children first; CASCADE clears dependent policies,
--    indexes, constraints and views)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.match_documents(vector, uuid, integer, float);
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, uuid, integer, float);
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;

DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;
DROP TABLE IF EXISTS public.document_chunks CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;

-- -----------------------------------------------------------------------------
-- 3. Tables
-- -----------------------------------------------------------------------------

-- Companies (the multi-tenant boundary)
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  api_key text UNIQUE NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Document metadata
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label text,
  source_name text NOT NULL,
  preview text,
  chunk_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Chunked document text plus embeddings (written by the n8n ingest workflow).
-- 384 dimensions matches sentence-transformers/multi-qa-MiniLM-L6-cos-v1.
--
-- source_name / label / chunk_index / metadata exist because the n8n "Insert
-- Chunk" node posts them. document_id is nullable: n8n writes chunks without
-- creating a documents row, while the web app creates documents rows itself.
CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  source_name text,
  label text,
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  embedding vector(384),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Chat conversations
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Chat messages
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 4. Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX idx_companies_owner_id ON public.companies (owner_id);
CREATE INDEX idx_companies_api_key ON public.companies (api_key);
CREATE INDEX idx_documents_company_id ON public.documents (company_id);
CREATE INDEX idx_chunks_company_id ON public.document_chunks (company_id);
CREATE INDEX idx_chunks_document_id ON public.document_chunks (document_id);
CREATE INDEX idx_chunks_company_source ON public.document_chunks (company_id, source_name);
CREATE INDEX idx_conversations_company_id ON public.conversations (company_id);
CREATE INDEX idx_conversations_user_id ON public.conversations (user_id);
CREATE INDEX idx_messages_conversation_id ON public.messages (conversation_id);

-- HNSW rather than IVFFlat: IVFFlat builds its centroids from whatever rows
-- exist at CREATE INDEX time, so building it on an empty table gives poor
-- recall until it is rebuilt. HNSW needs no training data.
CREATE INDEX idx_chunks_embedding ON public.document_chunks
  USING hnsw (embedding vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- 5. Keep updated_at honest
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. Row Level Security
-- -----------------------------------------------------------------------------
-- Note: the service_role key used by n8n bypasses RLS entirely, so the ingest
-- and chat workflows need no policies of their own.

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Companies: a user only ever sees the companies they own.
CREATE POLICY companies_select_own ON public.companies
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);

CREATE POLICY companies_insert_own ON public.companies
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

CREATE POLICY companies_update_own ON public.companies
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY companies_delete_own ON public.companies
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Documents: scoped to companies the user owns.
CREATE POLICY documents_select_company ON public.documents
  FOR SELECT TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

CREATE POLICY documents_insert_company ON public.documents
  FOR INSERT TO authenticated WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

CREATE POLICY documents_update_company ON public.documents
  FOR UPDATE TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

CREATE POLICY documents_delete_company ON public.documents
  FOR DELETE TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

-- Document chunks: same company scoping.
CREATE POLICY chunks_select_company ON public.document_chunks
  FOR SELECT TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

CREATE POLICY chunks_insert_company ON public.document_chunks
  FOR INSERT TO authenticated WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

CREATE POLICY chunks_delete_company ON public.document_chunks
  FOR DELETE TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

-- Conversations: owned by the user, and only inside a company they own.
CREATE POLICY conversations_select_user ON public.conversations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY conversations_insert_user ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

CREATE POLICY conversations_delete_user ON public.conversations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Messages: reachable only through a conversation the user owns.
CREATE POLICY messages_select_own ON public.messages
  FOR SELECT TO authenticated USING (
    conversation_id IN (SELECT id FROM public.conversations WHERE user_id = auth.uid())
  );

CREATE POLICY messages_insert_own ON public.messages
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND conversation_id IN (SELECT id FROM public.conversations WHERE user_id = auth.uid())
  );

CREATE POLICY messages_delete_own ON public.messages
  FOR DELETE TO authenticated USING (
    conversation_id IN (SELECT id FROM public.conversations WHERE user_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 7. Vector similarity search (called by the n8n "Match Documents" node)
-- -----------------------------------------------------------------------------
-- The parameter names below are part of the contract: PostgREST matches RPC
-- arguments by name against the JSON body keys, so these must stay exactly
-- query_embedding / match_company_id / match_count / match_threshold.
--
-- The returned columns are what the "Build Context" node reads
-- (content, source_name, label, similarity).
--
-- SECURITY INVOKER so RLS still applies to end users calling this directly.
-- n8n uses the service_role key, which bypasses RLS regardless.
CREATE FUNCTION public.match_documents(
  query_embedding vector(384),
  match_company_id uuid,
  match_count integer DEFAULT 5,
  match_threshold float DEFAULT 0.0
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  source_name text,
  label text,
  chunk_index integer,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.document_id,
    c.content,
    c.source_name,
    c.label,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks c
  WHERE c.company_id = match_company_id
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- -----------------------------------------------------------------------------
-- 8. Grants (RLS above is what actually restricts rows; these just open the
--    tables to the PostgREST roles)
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.companies,
  public.documents,
  public.document_chunks,
  public.conversations,
  public.messages
TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.match_documents(vector, uuid, integer, float)
  TO authenticated, service_role;

-- PostgREST caches the schema; this is what PGRST204 ("Could not find the
-- '<column>' column ... in the schema cache") means. Supabase reloads
-- automatically via event trigger, but this makes it immediate.
NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 9. Verify — every row below should report the expected shape
-- -----------------------------------------------------------------------------
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('companies', 'documents', 'document_chunks', 'conversations', 'messages')
ORDER BY table_name, ordinal_position;
