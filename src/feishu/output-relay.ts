export interface FeishuOutputRelayOptions {
  sendText: (text: string) => Promise<void>;
  onError?: (error: unknown) => void;
  quietMs?: number;
  maxChunkLength?: number;
}

export class FeishuOutputRelay {
  private readonly quietMs: number;
  private readonly maxChunkLength: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = "";
  private scrollback = "";

  constructor(private readonly options: FeishuOutputRelayOptions) {
    this.quietMs = options.quietMs ?? 800;
    this.maxChunkLength = options.maxChunkLength ?? 3500;
  }

  append(text: string): void {
    if (!text) return;
    this.pending += text;
    this.scrollback += text;
    this.scheduleFlush();
  }

  getScrollback(): string {
    return this.scrollback;
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const text = this.pending;
    this.pending = "";
    if (!text.trim()) return;

    for (const chunk of chunkText(text, this.maxChunkLength)) {
      await this.options.sendText(chunk);
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = "";
  }

  private scheduleFlush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flush().catch((error) => this.options.onError?.(error));
    }, this.quietMs);
  }
}

function chunkText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks;
}
