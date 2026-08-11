#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION, loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      [
        `${SERVER_NAME} ${SERVER_VERSION}`,
        "",
        "Research tools for tokenized real-world assets on Solana, served over MCP on stdio.",
        "",
        "Environment:",
        "  SOLANA_RPC_URL        Solana JSON-RPC endpoint. Defaults to a public node.",
        "  METIS_API_URL         Metis research API base URL. Defaults to https://metisagent.co.",
        "  METIS_ASSETS_FILE     JSON file with extra assets to register.",
        "  METIS_MCP_STATE_DIR   Where observation history is stored. Set to \"off\" for memory only.",
        "  METIS_MCP_TIMEOUT_MS  Network timeout per request. Defaults to 20000.",
        "",
      ].join("\n"),
    );
    return;
  }

  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout carries the protocol, so every diagnostic goes to stderr.
  process.stderr.write(
    `${SERVER_NAME} ${SERVER_VERSION} ready. RPC ${new URL(config.solanaRpcUrl).host}, API ${config.apiBaseUrl}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${SERVER_NAME} failed to start: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
