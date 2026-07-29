const N8N_BASE_URL = 'https://n8n.sysmatixx.com/webhook';

/**
 * What a workspace is being given to index.
 *
 * A file is one option, not the requirement — pasted text and a website URL are
 * equally valid context. The `kind` rides along as `source_type` so the workflow
 * can branch on it explicitly instead of inferring from which field is present.
 */
export type IngestSource =
  | { kind: 'file'; file: File }
  | { kind: 'text'; content: string }
  // A URL arrives already reduced to text by /api/extract-url, because the
  // workflow ingests text and files, not addresses. The address itself rides
  // along as provenance.
  | { kind: 'url'; url: string; content: string };

export interface DocumentUploadPayload {
  api_key: string;
  source_name: string;
  label: string;
  source: IngestSource;
}

export interface IngestResponse {
  success: boolean;
  message?: string;
  chunks_created?: number;
  company_id?: string;
  error?: string;
}

export interface ChatPayload {
  api_key: string;
  question: string;
  /**
   * Conversation scope for the workflow's memory node.
   *
   * Unique per conversation and per browser, and constant across every turn of
   * a single conversation — so a memory node keyed on it accumulates that
   * thread's context and never bleeds between threads or visitors.
   */
  memory_key?: string;
}

export interface ChatSource {
  source?: string;
  label?: string;
  similarity?: number;
}

export interface ChatResponse {
  success?: boolean;
  answer: string;
  sources?: ChatSource[];
  error?: string;
}

/**
 * Workflows that answer through a "Respond to Webhook" node often return 200
 * with an error in the body rather than a real status code. The status is the
 * reliable signal; this is the fallback for that case.
 */
const EXPLICIT_REJECTION = /unauthori[sz]ed|forbidden/i;
const API_KEY_MENTION = /api[_\s-]?key/i;
const REJECTION_WORD = /invalid|unknown|expired|missing|not found/i;

function looksLikeRejectedKey(message: string): boolean {
  if (EXPLICIT_REJECTION.test(message)) return true;
  // Both halves required, so an unrelated message that merely names the field
  // is not mistaken for a rejection.
  return API_KEY_MENTION.test(message) && REJECTION_WORD.test(message);
}

/** A webhook call that came back with a usable HTTP status. */
export class N8nError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'N8nError';
    this.status = status;
    this.body = body;
  }

  /**
   * The workspace key itself was refused — the workspace was deleted or its key
   * was rotated, so the link is dead.
   *
   * 404 is deliberately excluded: n8n returns it for a webhook that is not
   * registered, which means the workflow is inactive, not that the key is bad.
   * Telling a visitor their link is dead because a workflow was paused would be
   * the wrong diagnosis.
   */
  get isRejectedKey(): boolean {
    if (this.status === 401 || this.status === 403) return true;
    return this.status === 200 && looksLikeRejectedKey(this.message);
  }
}

/** Pulls the error message out of an n8n webhook response body. */
function errorFrom(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const { error, message } = body as { error?: string; message?: string };
    if (error) return error;
    if (message) return message;
  }
  return fallback;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class N8nClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = N8N_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Sends context to the n8n ingest webhook.
   *
   * Always multipart/form-data, even when there is no file: the workflow's
   * "Has File?" branch tests for binary data on the webhook item, so a text or
   * URL submission simply arrives without a `file` part and falls to the other
   * branch. Reading a file into a string here would hand n8n unusable bytes for
   * anything but plain text.
   *
   * Content-Type is deliberately not set — the browser adds it along with the
   * multipart boundary, which cannot be written by hand.
   */
  async uploadDocument(payload: DocumentUploadPayload): Promise<IngestResponse> {
    const form = new FormData();
    form.append('api_key', payload.api_key);
    form.append('source_name', payload.source_name);
    form.append('label', payload.label);
    form.append('source_type', payload.source.kind);

    if (payload.source.kind === 'file') {
      form.append('file', payload.source.file, payload.source_name);
    } else {
      // Sent under both names on purpose. The workflow's validation reports
      // "No text or file content was provided", and the docs describe
      // `content` — so which field it reads is not settled. Drop whichever is
      // unused once the workflow confirms it.
      form.append('text', payload.source.content);
      form.append('content', payload.source.content);

      if (payload.source.kind === 'url') {
        form.append('source_url', payload.source.url);
      }
    }

    const response = await fetch(`${this.baseUrl}/ingest`, {
      method: 'POST',
      body: form,
    });

    const body = (await readBody(response)) as IngestResponse | null;

    if (!response.ok) {
      throw new N8nError(
        errorFrom(body, `Upload failed (${response.status} ${response.statusText})`),
        response.status,
        body,
      );
    }

    if (!body || body.success === false) {
      throw new N8nError(errorFrom(body, 'Upload failed'), response.status, body);
    }

    return body;
  }

  async chat(payload: ChatPayload): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = (await readBody(response)) as ChatResponse | null;

    if (!response.ok) {
      throw new N8nError(
        errorFrom(body, `Chat failed (${response.status} ${response.statusText})`),
        response.status,
        body,
      );
    }

    if (!body || body.success === false) {
      throw new N8nError(errorFrom(body, 'Chat failed'), response.status, body);
    }

    return body;
  }
}

export const n8nClient = new N8nClient();
