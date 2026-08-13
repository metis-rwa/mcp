import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { SERVER_VERSION, loadConfig } from "../dist/config.js";

const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const pkg = read("../package.json");
const server = read("../server.json");
const marketplace = read("../.claude-plugin/marketplace.json");
const plugin = read("../plugin/.claude-plugin/plugin.json");
const mcpConfig = read("../plugin/.mcp.json");

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

// The plugin is config and prose, so nothing here fails at build time. These
// checks stand in for `claude plugin validate`, which needs the CLI.
test("the marketplace points at a plugin that exists", () => {
  assert.equal(marketplace.plugins.length, 1);
  const entry = marketplace.plugins[0];
  assert.equal(entry.name, plugin.name);
  assert.equal(entry.version, plugin.version);
  assert.equal(entry.version, pkg.version);
  assert.match(entry.source, /^\.\//, "source must be a path inside this repo");
  assert.ok(
    existsSync(new URL(`../${entry.source.slice(2)}/.claude-plugin/plugin.json`, import.meta.url)),
    `${entry.source} should contain a plugin manifest`,
  );
});

test("the plugin connects to the same endpoint the registry advertises", () => {
  const servers = Object.values(mcpConfig.mcpServers);
  assert.equal(servers.length, 1);
  // An entry with a url and no type is read as stdio and silently skipped.
  assert.equal(servers[0].type, "http");
  assert.equal(servers[0].url, server.remotes[0].url);
});

test("plugin components sit at the plugin root, not inside .claude-plugin", () => {
  // The documented way to get a plugin that loads but does nothing: put
  // skills/ or .mcp.json inside .claude-plugin/ where nothing reads them.
  const manifestDir = new URL("../plugin/.claude-plugin/", import.meta.url);
  assert.deepEqual(readdirSync(manifestDir), ["plugin.json"]);
  for (const required of ["skills", ".mcp.json", "README.md"]) {
    assert.ok(
      existsSync(new URL(`../plugin/${required}`, import.meta.url)),
      `${required} should sit at the plugin root`,
    );
  }
});

test("names are kebab-case, which is what the catalog requires", () => {
  for (const name of [marketplace.name, plugin.name, ...readdirSync(new URL("../plugin/skills/", import.meta.url))]) {
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${name} is not kebab-case`);
  }
});

test("every skill carries a description so Claude knows when to use it", () => {
  const dir = new URL("../plugin/skills/", import.meta.url);
  const skills = readdirSync(dir);
  assert.ok(skills.length >= 3, "expected the shipped skills");
  for (const name of skills) {
    const text = readFileSync(new URL(`${name}/SKILL.md`, dir), "utf8");
    const frontmatter = text.split("---")[1] ?? "";
    assert.match(frontmatter, /\ndescription: \S/, `${name} needs a description`);
    assert.match(frontmatter, new RegExp(`\\nname: ${name}\\n`), `${name} needs a matching name`);
  }
});
