export function usd(value: number | null | undefined, places = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })}`;
}

export function num(value: number | null | undefined, places = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

export function pct(ratio: number | null | undefined, places = 2): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "n/a";
  return `${(ratio * 100).toFixed(places)}%`;
}

export function bps(value: number | null | undefined, places = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(places)}bps`;
}

export function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;
}

export function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return rows.length > 0 ? `${head}\n${rule}\n${body}` : `${head}\n${rule}`;
}

export function bullets(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

export function section(title: string, body: string): string {
  return `## ${title}\n\n${body}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = now - Date.parse(iso);
  if (!Number.isFinite(diff)) return iso;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
