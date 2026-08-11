import { createHash } from "node:crypto";

/** Provenance stamp for one outbound fetch. Every source read carries origin,
 *  retrieval time, and a hash of the raw payload so an answer can be audited
 *  after the fact. */
export interface SourceFetchRecord {
  sourceId: string;
  url: string;
  retrievedAt: string;
  payloadHash: string;
  latencyMs: number;
}

export class SourceError extends Error {
  constructor(
    public readonly sourceId: string,
    message: string,
  ) {
    super(`[${sourceId}] ${message}`);
    this.name = "SourceError";
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface FetchOptions {
  timeoutMs: number;
  userAgent: string;
  init?: RequestInit;
  /** URL recorded as evidence when the real endpoint must stay private. */
  evidenceUrl?: string;
}

export async function fetchTextWithRecord(
  sourceId: string,
  url: string,
  options: FetchOptions,
): Promise<{ text: string; record: SourceFetchRecord }> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      ...options.init,
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: {
        accept: "application/json",
        "user-agent": options.userAgent,
        ...options.init?.headers,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SourceError(sourceId, `request failed: ${reason}`);
  }
  if (!response.ok) {
    throw new SourceError(sourceId, `HTTP ${response.status} from ${url}`);
  }
  const text = await response.text();
  return {
    text,
    record: {
      sourceId,
      url: options.evidenceUrl ?? url,
      retrievedAt: new Date().toISOString(),
      payloadHash: `sha256:${sha256Hex(text)}`,
      latencyMs: Date.now() - started,
    },
  };
}

export async function fetchJsonWithRecord(
  sourceId: string,
  url: string,
  options: FetchOptions,
): Promise<{ json: unknown; record: SourceFetchRecord }> {
  const { text, record } = await fetchTextWithRecord(sourceId, url, options);
  try {
    return { json: JSON.parse(text) as unknown, record };
  } catch {
    throw new SourceError(sourceId, `non-JSON payload from ${url}`);
  }
}
