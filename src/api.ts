import type { Config } from "./config.js";

export interface ResearchSummary {
  id: string;
  slug: string;
  version: number;
  category: string;
  title: string;
  dek: string;
  assets: Array<{ symbol: string; chain?: string }>;
  confidence: { band: string; score: number };
  impact: string;
  publishedAt: string;
  updatedAt: string;
  canonicalUrl: string;
  contentHash: string;
}

export interface LivePayload {
  runtime: {
    status: string;
    generatedAt: string;
    activeInvestigation: {
      runId: string;
      stage: string;
      category: string;
      subject: string;
      assetSymbols: string[];
      startedAt: string;
      lastUpdateAt: string;
      observationCount: number;
      verifiedSourceCount: number;
      conflictingSignalCount: number;
    } | null;
    queuedInvestigations: Array<{
      category: string;
      subject: string;
      scheduledFor: string;
    }>;
    sourceHealth: Array<{
      sourceClass: string;
      label: string;
      state: string;
      lastCheckedAt: string;
    }>;
  };
  events: Array<{
    id: string;
    runId: string;
    occurredAt: string;
    stage: string;
    kind: string;
    message: string;
    sourceClass?: string;
  }>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Client for the public Metis research API. Everything it reads is already
 *  public and needs no credentials. */
export class MetisApi {
  constructor(private readonly config: Config) {}

  private async get<T>(path: string): Promise<T> {
    const url = `${this.config.apiBaseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        headers: {
          accept: "application/json",
          "user-agent": this.config.userAgent,
        },
      });
    } catch (error) {
      throw new ApiError(
        `could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (response.status === 404) {
      throw new ApiError(`nothing published at ${path}`, 404);
    }
    if (!response.ok) {
      throw new ApiError(`HTTP ${response.status} from ${url}`, response.status);
    }
    const body = (await response.json()) as { data?: T };
    if (body.data === undefined) {
      throw new ApiError(`response from ${url} carried no data envelope`);
    }
    return body.data;
  }

  async listResearch(params: {
    category?: string;
    asset?: string;
  }): Promise<ResearchSummary[]> {
    const query = new URLSearchParams();
    if (params.category) query.set("category", params.category);
    if (params.asset) query.set("asset", params.asset);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.get<ResearchSummary[]>(`/api/v1/research${suffix}`);
  }

  /** Full research object. The API accepts either the object id or its slug. */
  async getResearch(idOrSlug: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(
      `/api/v1/research/${encodeURIComponent(idOrSlug)}`,
    );
  }

  async getLive(): Promise<LivePayload> {
    return this.get<LivePayload>("/api/v1/live");
  }
}
