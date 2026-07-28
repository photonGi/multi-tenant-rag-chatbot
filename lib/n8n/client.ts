const N8N_BASE_URL = 'https://n8n.sysmatixx.com/webhook';

export interface DocumentUploadPayload {
  api_key: string;
  source_name: string;
  label: string;
  file: File;
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
  private baseUrl: string;

  constructor(baseUrl: string = N8N_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Uploads a document to the n8n ingest webhook.
   *
   * Sent as multipart/form-data, not JSON: the workflow's "Has File?" branch
   * looks for binary data on the webhook item, and the PDF text extraction
   * node reads the binary property named `file`. Reading the file into a
   * string here would hand n8n unusable bytes for anything but plain text.
   *
   * Content-Type is deliberately not set — the browser adds it along with the
   * multipart boundary, which cannot be written by hand.
   */
  async uploadDocument(payload: DocumentUploadPayload): Promise<IngestResponse> {
    const form = new FormData();
    form.append('api_key', payload.api_key);
    form.append('source_name', payload.source_name);
    form.append('label', payload.label);
    form.append('file', payload.file, payload.source_name);

    const response = await fetch(`${this.baseUrl}/ingest`, {
      method: 'POST',
      body: form,
    });

    const body = (await readBody(response)) as IngestResponse | null;

    if (!response.ok) {
      throw new Error(
        errorFrom(body, `Upload failed (${response.status} ${response.statusText})`),
      );
    }

    if (!body || body.success === false) {
      throw new Error(errorFrom(body, 'Upload failed'));
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
      throw new Error(
        errorFrom(body, `Chat failed (${response.status} ${response.statusText})`),
      );
    }

    if (!body || body.success === false) {
      throw new Error(errorFrom(body, 'Chat failed'));
    }

    return body;
  }
}

export const n8nClient = new N8nClient();
