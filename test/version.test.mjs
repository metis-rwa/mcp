import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SERVER_VERSION, loadConfig } from "../dist/config.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));

// The version lives in four places and every release has to move all of them.
// A client reads two of them, and the MCP registry refuses a publish where its
// own copy disagrees with npm, so drift here is caught at the worst moment.
test("the version the server reports matches the package", () => {
  assert.equal(SERVER_VERSION, pkg.version);
  assert.match(loadConfig({}).userAgent, new RegExp(`metis-mcp/${pkg.version}\\b`));
});

test("server.json agrees with package.json", () => {
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, pkg.version);
  // The registry proves ownership by matching these two strings.
  assert.equal(server.name, pkg.mcpName);
});

test("the hosted endpoint is advertised alongside the package", () => {
  const remote = server.remotes?.find((r) => r.type === "streamable-http");
  assert.ok(remote, "server.json should list the hosted endpoint");
  assert.equal(remote.url, "https://metisagent.co/mcp");
});
