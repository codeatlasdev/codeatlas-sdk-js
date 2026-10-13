#!/usr/bin/env node
import {
  CodeAtlas,
  CodeAtlasError,
  DEFAULT_BASE_URL,
  SANDBOX_BASE_URL,
  type ContactLocale,
  type Service,
} from "./index.js";

const VERSION = "0.1.0";

const HELP = `codeatlas ${VERSION}: CLI for the public CodeAtlas API

Usage:
  codeatlas services list [--limit N] [--cursor C] [--json]
  codeatlas services get <slug> [--json]
  codeatlas services search <query> [--json]
  codeatlas services batch <slug> [<slug>...] [--json]
  codeatlas health [--json]
  codeatlas export <jsonl|csv|md> [--out FILE] [--json]   (needs credentials)
  codeatlas register <client-name> [--json]
  codeatlas contact --name N --email E --message M [--company C] [--service SLUG]
                    [--locale pt-BR|en] [--idempotency-key K] [--sandbox] [--json]

Options:
  --json        Print raw JSON
  --base-url U  API base URL (default ${DEFAULT_BASE_URL}, or $CODEATLAS_API_URL)
  --sandbox     Use the sandbox API: writes are validated, nothing is stored or sent

Write commands need OAuth credentials: run "codeatlas register <name>", then set
CODEATLAS_CLIENT_ID and CODEATLAS_CLIENT_SECRET.
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
      else if (["json", "help", "version", "sandbox"].includes(key as string)) flags[key as string] = true;
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
  const clientId = process.env.CODEATLAS_CLIENT_ID;
  const clientSecret = process.env.CODEATLAS_CLIENT_SECRET;
  const client = new CodeAtlas({
    baseUrl:
      (typeof flags["base-url"] === "string" ? flags["base-url"] : undefined) ??
      process.env.CODEATLAS_API_URL ??
      (flags.sandbox === true ? SANDBOX_BASE_URL : undefined),
    credentials: clientId && clientSecret ? { clientId, clientSecret } : undefined,
  });
  const out = (value: unknown, text: () => string) =>
    console.log(json ? JSON.stringify(value, null, 2) : text());

  const [group, action, ...rest] = positionals;

  if (group === "health") {
    const health = await client.health();
    out(health, () => `${health.status} (${health.service} ${health.version})`);
    return 0;
  }

  if (group === "register") {
    const clientName = [action, ...rest].filter(Boolean).join(" ");
    if (!clientName) throw new Error("Usage: codeatlas register <client-name>");
    const registered = await CodeAtlas.register(clientName);
    out(registered, () =>
      [
        `export CODEATLAS_CLIENT_ID=${registered.clientId}`,
        `export CODEATLAS_CLIENT_SECRET=${registered.clientSecret}`,
        "# The secret is shown once. Store it.",
      ].join("\n")
    );
    return 0;
  }

  if (group === "contact") {
    const str = (key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);
    const name = str("name");
    const email = str("email");
    const message = str("message");
    if (!name || !email || !message) {
      throw new Error("Usage: codeatlas contact --name N --email E --message M [--company C] [--service SLUG] [--locale pt-BR|en]");
    }
    const created = await client.contactRequests.create(
      {
        name,
        email,
        message,
        company: str("company"),
        service_slug: str("service"),
        locale: str("locale") as ContactLocale | undefined,
      },
      { idempotencyKey: str("idempotency-key") }
    );
    out({ data: created }, () => `${created.id} ${created.status} (${created.delivery})`);
    return 0;
  }

  if (group === "export") {
    const format = action;
    if (format !== "jsonl" && format !== "csv" && format !== "md") {
      throw new Error("Usage: codeatlas export <jsonl|csv|md> [--out FILE]");
    }
    const job = await client.exports.wait((await client.exports.create(format)).id);
    const file = await client.exports.download(job.id);
    const outPath = typeof flags.out === "string" ? flags.out : undefined;
    if (outPath) {
      await (await import("node:fs/promises")).writeFile(outPath, file);
      out({ data: job, file: outPath }, () => `${job.id} ${job.status}: wrote ${outPath}`);
    } else {
      process.stdout.write(file.endsWith("\n") ? file : `${file}\n`);
    }
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
    if (action === "batch") {
      if (rest.length === 0) throw new Error("Usage: codeatlas services batch <slug> [<slug>...]");
      const results = await client.services.batch(rest);
      out({ data: results, count: results.length }, () =>
        results
          .map((r) => (r.data ? formatService(r.data) : `${r.slug ?? "(invalid)"}  ${r.status} ${r.error?.code ?? ""}: ${r.error?.message ?? ""}`))
          .join("\n\n")
      );
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
