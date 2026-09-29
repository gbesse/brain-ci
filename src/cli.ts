#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { check, toMarkdown } from "./index.js";

function usage(): never {
  throw new Error("Usage: brain-ci check --base <git-ref> --config <file> [--repo <dir>] [--judge exact|typesafe] [--max-calls N] [--json <file>] [--markdown <file>]");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.shift() !== "check") usage();
  const flags = new Map<string, string>();
  while (args.length) {
    const key = args.shift();
    const value = args.shift();
    if (!key?.startsWith("--") || !value || value.startsWith("--") || flags.has(key)) usage();
    flags.set(key, value);
  }
  const allowed = new Set(["--base", "--config", "--repo", "--judge", "--max-calls", "--json", "--markdown"]);
  for (const key of flags.keys()) if (!allowed.has(key)) usage();
  const base = flags.get("--base");
  const config = flags.get("--config");
  if (!base || !config) usage();
  const judge = flags.get("--judge") ?? "exact";
  if (judge !== "exact" && judge !== "typesafe") usage();
  const maxCalls = Number(flags.get("--max-calls") ?? "20");
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 0) usage();
  const repo = resolve(flags.get("--repo") ?? process.cwd());
  const report = await check({ repo, config: resolve(repo, config), base, judge, maxCalls });
  const markdown = toMarkdown(report);
  for (const [flag, content] of [["--json", JSON.stringify(report, null, 2) + "\n"], ["--markdown", markdown + "\n"]] as const) {
    const target = flags.get(flag);
    if (target) {
      const path = resolve(repo, target);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
  }
  process.stdout.write(`${report.counts.pass} pass, ${report.counts.regression} regression, ${report.counts.review} review\n`);
  for (const result of report.results) process.stdout.write(`${result.verdict.toUpperCase()} ${result.id}: ${result.reason}\n`);
  if (report.counts.regression) process.exitCode = 1;
  else if (report.counts.review) process.exitCode = 2;
}

main().catch((error: unknown) => {
  process.stderr.write(`brain-ci: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
