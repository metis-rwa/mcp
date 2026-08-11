import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  /** Base URL of the public Metis research API. */
  apiBaseUrl: string;
  /** Solana JSON-RPC endpoint used for every on-chain read. */
  solanaRpcUrl: string;
  /** Directory for the local observation history, or null when disabled. */
  stateDir: string | null;
  /** Network timeout applied to every outbound request. */
  requestTimeoutMs: number;
  userAgent: string;
}

/** PublicNode answers non-browser clients. api.mainnet-beta.solana.com
 *  rejects some runtimes outright, so it is a poor default. */
const DEFAULT_RPC = "https://solana-rpc.publicnode.com";
const DEFAULT_API = "https://metisagent.co";

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const stateSetting = env.METIS_MCP_STATE_DIR?.trim();
  const stateDir =
    stateSetting === "off" || stateSetting === "none"
      ? null
      : stateSetting && stateSetting.length > 0
        ? stateSetting
        : join(homedir(), ".metis-mcp");

  const timeout = Number(env.METIS_MCP_TIMEOUT_MS ?? "");

  return {
    apiBaseUrl: trimSlash(env.METIS_API_URL?.trim() || DEFAULT_API),
    solanaRpcUrl: env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC,
    stateDir,
    requestTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 20_000,
    userAgent: "metis-mcp/0.1.0 (+https://metisagent.co)",
  };
}

export const SERVER_NAME = "metis-rwa";
export const SERVER_VERSION = "0.1.0";
