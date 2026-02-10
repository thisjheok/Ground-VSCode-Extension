export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface OllamaProviderOptions {
  baseUrl: string;           // e.g. http://localhost:11434
  model: string;             // e.g. qwen2.5-coder:3b
  timeoutMs?: number;        // e.g. 60_000
}

export class OllamaProvider {
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;

  constructor(opts: OllamaProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async healthCheck(): Promise<{ ok: boolean; reason?: string; models?: string[] }> {
    try {
      const json = await this.fetchJson(`${this.baseUrl}/api/tags`, { method: "GET" });
      const models = Array.isArray(json?.models) ? json.models.map((m: any) => m?.name).filter(Boolean) : [];
      return { ok: true, models };
    } catch (e: any) {
      return { ok: false, reason: this.humanizeError(e) };
    }
  }

  async chatOnce(messages: ChatMessage[]): Promise<string> {
    const body = { model: this.model, stream: false, messages };
    const json = await this.fetchJson(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const content = json?.message?.content;
    if (typeof content !== "string") throw new Error("Ollama response missing message.content");
    return content;
  }

  /**
   * Stream NDJSON chunks from /api/chat and call onDelta with incremental text.
   * Ollama returns newline-delimited JSON objects.
   */
  async chatStream(
    messages: ChatMessage[],
    onDelta: (deltaText: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const body = { model: this.model, stream: true, messages };
    const res = await this.fetchRaw(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      const text = await safeReadText(res);
      throw new Error(`Ollama stream failed: HTTP ${res.status} ${res.statusText} ${text ?? ""}`.trim());
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Ollama streaming is NDJSON: one JSON per line
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);

        if (!line) continue;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue; // ignore malformed line
        }

        const chunk = obj?.message?.content;
        if (typeof chunk === "string" && chunk.length > 0) onDelta(chunk);

        if (obj?.done === true) return;
      }
    }

    // Process trailing line without newline.
    const lastLine = buffer.trim();
    if (!lastLine) return;
    try {
      const obj: any = JSON.parse(lastLine);
      const chunk = obj?.message?.content;
      if (typeof chunk === "string" && chunk.length > 0) onDelta(chunk);
    } catch {
      // ignore malformed trailing chunk
    }
  }

  private async fetchJson(url: string, init: RequestInit): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        signal: this.mergeSignals(init.signal, controller.signal),
      });
      if (!res.ok) {
        const text = await safeReadText(res);
        throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchRaw(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: this.mergeSignals(init.signal, controller.signal),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private mergeSignals(...signals: Array<AbortSignal | null | undefined>): AbortSignal | undefined {
    const actives = signals.filter((s): s is AbortSignal => Boolean(s));
    if (actives.length === 0) return undefined;
    if (actives.length === 1) return actives[0];
    return AbortSignal.any(actives);
  }

  private humanizeError(e: any): string {
    const msg = String(e?.message ?? e);
    if (msg.includes("ECONNREFUSED") || msg.includes("Failed to fetch")) {
      return "Cannot reach Ollama. Is it running at the configured baseUrl?";
    }
    if (msg.toLowerCase().includes("abort")) return "Request timed out or cancelled.";
    return msg;
  }
}

async function safeReadText(res: Response): Promise<string | null> {
  try { return await res.text(); } catch { return null; }
}
