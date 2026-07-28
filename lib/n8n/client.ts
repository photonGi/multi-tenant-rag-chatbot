const N8N_BASE_URL = 'https://n8n.sysmatixx.com/webhook';

export interface DocumentUploadPayload {
  api_key: string;
  source_name: string;
  label: string;
  content: string;
  file_type: string;
}

export interface ChatPayload {
  api_key: string;
  question: string;
}

export interface ChatResponse {
  answer: string;
  has_context: boolean;
  context?: string;
}

export class N8nClient {
  private baseUrl: string;

  constructor(baseUrl: string = N8N_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async uploadDocument(payload: DocumentUploadPayload): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`n8n error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[n8n] Upload error:', error);
      throw error;
    }
  }

  async chat(payload: ChatPayload): Promise<ChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`n8n error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[n8n] Chat error:', error);
      throw error;
    }
  }
}

export const n8nClient = new N8nClient();
