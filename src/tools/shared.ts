import type { Config } from "../config.js";
import type { MetisApi } from "../api.js";
import type { HistoryStore } from "../history.js";
import { DexScreenerSource } from "../sources/dexscreener.js";
import { JupiterSource } from "../sources/jupiter.js";
import { SolanaSource } from "../sources/solana.js";

export interface ToolContext {
  config: Config;
  api: MetisApi;
  history: HistoryStore;
  solana: SolanaSource;
  dex: DexScreenerSource;
  jupiter: JupiterSource;
}

export function createContext(
  config: Config,
  api: MetisApi,
  history: HistoryStore,
): ToolContext {
  const httpOptions = {
    timeoutMs: config.requestTimeoutMs,
    userAgent: config.userAgent,
  };
  return {
    config,
    api,
    history,
    solana: new SolanaSource({ rpcUrl: config.solanaRpcUrl, ...httpOptions }),
    dex: new DexScreenerSource(httpOptions),
    jupiter: new JupiterSource(httpOptions),
  };
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Public Solana endpoints throttle the heavier reads, and the resulting
 *  message on its own does not tell anyone what to do about it. */
function withRemedy(message: string): string {
  const throttled = /rate limit|429|timeout|aborted/i.test(message);
  if (throttled && message.includes("solana_rpc")) {
    return `${message}\n\nPublic Solana endpoints throttle heavier reads such as getTokenLargestAccounts. Point SOLANA_RPC_URL at a dedicated endpoint, or retry in a moment.`;
  }
  return message;
}

/** Tools report failures as content rather than throwing, so the model sees
 *  what went wrong and can pick a different asset or retry. */
export async function guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    return fail(withRemedy(error instanceof Error ? error.message : String(error)));
  }
}

export const ASSET_ARG_DESCRIPTION =
  "Registry symbol such as TSLAx, or any Solana mint address.";

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;
