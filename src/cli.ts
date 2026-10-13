#!/usr/bin/env node
import { CodeAtlas, CodeAtlasError, DEFAULT_BASE_URL, type Service } from "./index.js";

const VERSION = "0.1.0";

const HELP = `codeatlas ${VERSION}: CLI for the public CodeAtlas API

Usage:
  codeatlas services list [--limit N] [--cursor C] [--json]
  codeatlas services get <slug> [--json]
  codeatlas services search <query> [--json]
  codeatlas health [--json]

Options:
  --json        Print raw JSON
  --base-url U  API base URL (default ${DEFAULT_BASE_URL}, or $CODEATLAS_API_URL)
  -h, --help    Show help
  -v, --version Show version

Docs: https://codeatlas.com.br/docs`;

function parseArgs(argv: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=", 2);
      if (inline !== undefined) flags[key as string] = inline;
      else if (["json", "help", "version"].includes(key as string)) flags[key as string] = true;
      else flags[key as string] = argv[++i] ?? "";
    } else if (arg === "-h") flags.help = true;
    else if (arg === "-v") flags.version = true;
    else positionals.push(arg);
  }
  return { positionals, flags };
}

function formatService(s: Service): string {
  return [
    `${s.slug}  ${s.name}`,
    `  type:      ${s.serviceType}`,
    `  timeline:  ${s.deliveryTimeline}`,
    `  url:       ${s.url}`,
    `  includes:  ${s.capabilities.join(", ")}`,
    `  ${s.description}`,
  ].join("\n");
}

async function main(): Promise<number> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  if (flags.version) {
    console.log(VERSION);
    return 0;
  }
  if (flags.help || positionals.length === 0) {
    console.log(HELP);
    return positionals.length === 0 && !flags.help ? 1 : 0;
  }

  const json = flags.json === true;
  const client = new CodeAtlas({
    baseUrl:
      (typeof flags["base-url"] === "string" ? flags["base-url"] : undefined) ??
      process.env.CODEATLAS_API_URL,
  });
  const out = (value: unknown, text: () => string) =>
    console.log(json ? JSON.stringify(value, null, 2) : text());

  const [group, action, ...rest] = positionals;

  if (group === "health") {
    const health = await client.health();
    out(health, () => `${health.status} (${health.service} ${health.version})`);
    return 0;
  }

  if (group === "services") {
    if (action === "list") {
      const limit = typeof flags.limit === "string" ? Number(flags.limit) : undefined;
      const cursor = typeof flags.cursor === "string" ? flags.cursor : undefined;
      const page = await client.services.list({ limit, cursor });
      out(page, () =>
        [
          ...page.data.map(formatService),
          `\n${page.data.length} of ${page.count}` +
            (page.next_cursor ? ` (next: --cursor ${page.next_cursor})` : ""),
        ].join("\n\n")
      );
      return 0;
    }
    if (action === "get") {
      const slug = rest[0];
      if (!slug) throw new Error("Usage: codeatlas services get <slug>");
      const service = await client.services.get(slug);
      out({ data: service }, () => formatService(service));
      return 0;
    }
    if (action === "search") {
      const query = rest.join(" ");
      if (!query) throw new Error("Usage: codeatlas services search <query>");
      const results = await client.services.search(query);
      out({ data: results, count: results.length }, () =>
        results.length
          ? results.map(formatService).join("\n\n")
          : `No services match "${query}".`
      );
      return 0;
    }
  }

  console.error(`Unknown command: ${positionals.join(" ")}\n\n${HELP}`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof CodeAtlasError) {
      console.error(`error ${error.status} ${error.code}: ${error.message}`);
      if (error.hint) console.error(`hint: ${error.hint}`);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
);
