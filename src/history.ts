import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BaselinePoint } from "./research/types.js";

const MAX_POINTS = 500;
const COMPACT_AT = 700;

/** Observation history for one mint. Every call to the observe tool appends a
 *  point, so a session that checks an asset repeatedly builds the baseline the
 *  threshold detections need. Without history only level observations and the
 *  premium threshold can fire.
 *
 *  Storage is a JSON Lines file per mint under the state directory, or memory
 *  only when METIS_MCP_STATE_DIR is set to "off". */
export class HistoryStore {
  private readonly memory = new Map<string, BaselinePoint[]>();

  constructor(private readonly stateDir: string | null) {}

  private fileFor(mint: string): string | null {
    if (!this.stateDir) return null;
    const dir = join(this.stateDir, "observations");
    mkdirSync(dir, { recursive: true });
    return join(dir, `${mint}.jsonl`);
  }

  read(mint: string, limit = MAX_POINTS): BaselinePoint[] {
    const file = this.fileFor(mint);
    if (!file) return (this.memory.get(mint) ?? []).slice(-limit);
    if (!existsSync(file)) return [];
    const points: BaselinePoint[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        points.push(JSON.parse(line) as BaselinePoint);
      } catch {
        // A truncated final line from an interrupted write is skipped rather
        // than failing the read.
      }
    }
    return points.slice(-limit);
  }

  append(mint: string, point: BaselinePoint): void {
    const file = this.fileFor(mint);
    if (!file) {
      const points = this.memory.get(mint) ?? [];
      points.push(point);
      this.memory.set(mint, points.slice(-MAX_POINTS));
      return;
    }
    appendFileSync(file, `${JSON.stringify(point)}\n`, "utf8");
    const points = this.read(mint, COMPACT_AT + 1);
    if (points.length > COMPACT_AT) {
      const kept = points.slice(-MAX_POINTS);
      writeFileSync(
        file,
        `${kept.map((p) => JSON.stringify(p)).join("\n")}\n`,
        "utf8",
      );
    }
  }

  location(): string {
    return this.stateDir
      ? join(this.stateDir, "observations")
      : "memory only (history is discarded when the server stops)";
  }
}
