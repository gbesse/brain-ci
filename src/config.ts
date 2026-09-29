import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, sep } from "node:path";
import type { Config } from "./types.js";

export function safeRelativePath(value: string): boolean {
  if (!value || isAbsolute(value) || value.includes("\\") || value.includes("\0")) return false;
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

export function inside(root: string, relative: string): string {
  if (!safeRelativePath(relative)) throw new Error(`Unsafe relative path: ${relative}`);
  const target = normalize(`${root}${sep}${relative}`);
  if (!target.startsWith(`${root}${sep}`)) throw new Error(`Path escapes root: ${relative}`);
  return target;
}

export function parseConfig(raw: unknown): Config {
  if (!raw || typeof raw !== "object") throw new Error("Config must be an object");
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) throw new Error("Config version must be 1");
  if (typeof value.wiki !== "string" || !safeRelativePath(value.wiki)) throw new Error("wiki must be a safe relative directory");
  if (!Array.isArray(value.adapter) || value.adapter.length === 0 || !value.adapter.every((x) => typeof x === "string" && x.length > 0)) {
    throw new Error("adapter must be a nonempty command array");
  }
  if (!Array.isArray(value.cases) || value.cases.length === 0) throw new Error("cases must be a nonempty array");
  const ids = new Set<string>();
  for (const item of value.cases) {
    if (!item || typeof item !== "object") throw new Error("Each case must be an object");
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(row.id) || ids.has(row.id)) throw new Error("Case IDs must be unique slugs");
    ids.add(row.id);
    if (typeof row.question !== "string" || !row.question.trim()) throw new Error(`Case ${row.id} needs a question`);
    const exp = row.expectation as Record<string, unknown> | undefined;
    if (!exp || (exp.kind !== "preserve" && exp.kind !== "change")) throw new Error(`Case ${row.id} needs an expectation`);
    if (exp.kind === "change" && (typeof exp.to !== "string" || !exp.to.trim())) throw new Error(`Case ${row.id} needs expectation.to`);
  }
  return value as unknown as Config;
}

export async function loadConfig(path: string): Promise<Config> {
  return parseConfig(JSON.parse(await readFile(path, "utf8")));
}
