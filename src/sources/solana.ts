import {
  SourceError,
  fetchTextWithRecord,
  type SourceFetchRecord,
} from "./http.js";

interface RpcEnvelope {
  result?: unknown;
  error?: { code: number; message: string };
}

export interface SolanaOptions {
  rpcUrl: string;
  timeoutMs: number;
  userAgent: string;
}

/** The configured endpoint often carries an API key in its path or query
 *  (Alchemy, Helius and friends), so the raw URL must never leave this
 *  process. Callers pass a browsable explorer URL; this host-only form is the
 *  fallback. */
function redactedRpcUrl(rpcUrl: string, method: string): string {
  try {
    return `https://${new URL(rpcUrl).host}/#${method}`;
  } catch {
    return `solana-rpc#${method}`;
  }
}

const SUPPLY_INFO = "getTokenSupply";

export interface SupplySnapshot {
  record: SourceFetchRecord;
  uiAmount: number;
  rawAmount: string;
  decimals: number;
  slot: number;
}

export interface HolderAccount {
  address: string;
  uiAmount: number;
  share: number | null;
  owner?: string;
  frozen?: boolean;
}

export interface HoldersSnapshot {
  record: SourceFetchRecord;
  largest: HolderAccount[];
  top5Share: number | null;
  top10Share: number | null;
  ownersResolved: boolean;
}

export interface MintControls {
  record: SourceFetchRecord;
  program: "spl-token" | "spl-token-2022" | (string & {});
  decimals: number;
  supplyRaw: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: Array<{ extension: string; state: unknown }>;
}

export class SolanaSource {
  constructor(private readonly options: SolanaOptions) {}

  private async call(
    method: string,
    params: unknown[],
    evidenceUrl?: string,
  ): Promise<{ result: unknown; record: SourceFetchRecord }> {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const attempt = () =>
      fetchTextWithRecord("solana_rpc", this.options.rpcUrl, {
        timeoutMs: this.options.timeoutMs,
        userAgent: this.options.userAgent,
        evidenceUrl: evidenceUrl ?? redactedRpcUrl(this.options.rpcUrl, method),
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
      });

    // One retry: public endpoints throttle bursts, and a single refusal should
    // not read as an outage. A timeout is not retried, because an endpoint that
    // stalled on a heavy read stalls again and the caller waits twice for the
    // same answer.
    let fetched: Awaited<ReturnType<typeof attempt>>;
    try {
      fetched = await attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/timeout|aborted/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      fetched = await attempt();
    }

    const parsed = JSON.parse(fetched.text) as RpcEnvelope;
    if (parsed.error) {
      throw new SourceError(
        "solana_rpc",
        `${method}: ${parsed.error.message} (${parsed.error.code})`,
      );
    }
    return { result: parsed.result, record: fetched.record };
  }

  /** Circulating supply for a mint. uiAmountString is used so Token-2022
   *  scaled-amount mints report their effective supply. */
  async getSupply(mint: string): Promise<SupplySnapshot> {
    const { result, record } = await this.call(
      SUPPLY_INFO,
      [mint],
      `https://solscan.io/token/${mint}`,
    );
    const envelope = result as {
      context?: { slot?: number };
      value?: { amount: string; decimals: number; uiAmountString: string };
    } | null;
    const value = envelope?.value;
    if (!value) throw new SourceError("solana_rpc", `empty supply for ${mint}`);
    return {
      record,
      uiAmount: Number(value.uiAmountString),
      rawAmount: value.amount,
      decimals: value.decimals,
      slot: envelope?.context?.slot ?? 0,
    };
  }

  /** The 20 largest token accounts. These are accounts, not beneficial
   *  owners: pools, bridges and custodians dominate the top of the list. */
  async getLargestAccounts(
    mint: string,
    supplyUiAmount: number,
    resolveOwners = true,
  ): Promise<HoldersSnapshot> {
    const { result, record } = await this.call(
      "getTokenLargestAccounts",
      [mint],
      `https://solscan.io/token/${mint}#holders`,
    );
    const value = (
      result as {
        value?: Array<{
          address: string;
          uiAmountString?: string;
          uiAmount?: number;
        }>;
      } | null
    )?.value;
    if (!Array.isArray(value)) {
      throw new SourceError("solana_rpc", `empty largest accounts for ${mint}`);
    }

    const largest: HolderAccount[] = value.map((entry) => {
      const uiAmount = entry.uiAmountString
        ? Number(entry.uiAmountString)
        : (entry.uiAmount ?? 0);
      return {
        address: entry.address,
        uiAmount,
        share: supplyUiAmount > 0 ? uiAmount / supplyUiAmount : null,
      };
    });

    let ownersResolved = false;
    if (resolveOwners && largest.length > 0) {
      try {
        const owners = await this.getTokenAccountOwners(
          largest.map((a) => a.address),
        );
        for (const account of largest) {
          const info = owners.get(account.address);
          if (info) {
            account.owner = info.owner;
            account.frozen = info.frozen;
          }
        }
        ownersResolved = true;
      } catch {
        // Owner resolution is a convenience. A failure here leaves the
        // balances intact rather than failing the whole read.
        ownersResolved = false;
      }
    }

    const shareOfTop = (count: number) =>
      supplyUiAmount > 0
        ? largest.slice(0, count).reduce((sum, a) => sum + a.uiAmount, 0) /
          supplyUiAmount
        : null;

    return {
      record,
      largest,
      top5Share: shareOfTop(5),
      top10Share: shareOfTop(10),
      ownersResolved,
    };
  }

  private async getTokenAccountOwners(
    addresses: string[],
  ): Promise<Map<string, { owner: string; frozen: boolean }>> {
    const { result } = await this.call("getMultipleAccounts", [
      addresses,
      { encoding: "jsonParsed" },
    ]);
    const accounts = (
      result as {
        value?: Array<{
          data?: { parsed?: { info?: { owner?: string; state?: string } } };
        } | null>;
      } | null
    )?.value;
    const map = new Map<string, { owner: string; frozen: boolean }>();
    if (!Array.isArray(accounts)) return map;
    accounts.forEach((account, index) => {
      const address = addresses[index];
      const info = account?.data?.parsed?.info;
      if (!address || !info?.owner) return;
      map.set(address, { owner: info.owner, frozen: info.state === "frozen" });
    });
    return map;
  }

  /** Mint authorities and Token-2022 extensions. This is the issuer control
   *  surface: who can mint, freeze, seize, or gate transfers. */
  async getMintControls(mint: string): Promise<MintControls> {
    const { result, record } = await this.call(
      "getAccountInfo",
      [mint, { encoding: "jsonParsed" }],
      `https://solscan.io/token/${mint}`,
    );
    const account = (
      result as {
        value?: {
          data?: {
            program?: string;
            parsed?: {
              type?: string;
              info?: {
                decimals?: number;
                supply?: string;
                mintAuthority?: string | null;
                freezeAuthority?: string | null;
                extensions?: Array<{ extension: string; state: unknown }>;
              };
            };
          };
        } | null;
      } | null
    )?.value;

    const parsed = account?.data?.parsed;
    if (!parsed || parsed.type !== "mint" || !parsed.info) {
      throw new SourceError(
        "solana_rpc",
        `${mint} is not a parsable SPL mint account`,
      );
    }

    return {
      record,
      program: account?.data?.program ?? "unknown",
      decimals: parsed.info.decimals ?? 0,
      supplyRaw: parsed.info.supply ?? "0",
      mintAuthority: parsed.info.mintAuthority ?? null,
      freezeAuthority: parsed.info.freezeAuthority ?? null,
      extensions: parsed.info.extensions ?? [],
    };
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      await this.call("getHealth", []);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
