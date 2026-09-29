import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { inside, safeRelativePath } from "./config.js";
import type { Answer } from "./types.js";

function parseAnswer(raw: string): Answer {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Adapter output must be an object");
  const row = value as Record<string, unknown>;
  if (typeof row.answer !== "string" || !row.answer.trim()) throw new Error("Adapter must return a nonempty answer");
  if (!Array.isArray(row.citations) || row.citations.length === 0) throw new Error("Adapter must return at least one citation");
  for (const citation of row.citations) {
    if (!citation || typeof citation !== "object") throw new Error("Citation must be an object");
    const c = citation as Record<string, unknown>;
    if (typeof c.path !== "string" || !safeRelativePath(c.path)) throw new Error("Citation path must be relative to wiki");
    if (typeof c.quote !== "string" || !c.quote.trim()) throw new Error("Citation quote must be nonempty");
  }
  return value as Answer;
}

export async function ask(adapter: string[], repo: string, wikiRoot: string, question: string): Promise<Answer> {
  const [command, ...args] = adapter;
  if (!command) throw new Error("Missing adapter command");
  const answer = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repo,
      env: { ...process.env, BRAIN_CI_WIKI: wikiRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (part: string) => { stdout += part; if (stdout.length > 1_000_000) child.kill("SIGKILL"); });
    child.stderr.on("data", (part: string) => { stderr += part; if (stderr.length > 16_000) child.kill("SIGKILL"); });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Adapter exited ${code}: ${stderr.slice(0, 500)}`));
      else resolve(stdout);
    });
    child.stdin.end(JSON.stringify({ question }) + "\n");
  });
  const parsed = parseAnswer(answer);
  for (const citation of parsed.citations) {
    const body = await readFile(inside(wikiRoot, citation.path), "utf8");
    if (!body.includes(citation.quote)) throw new Error(`Citation quote not found in ${citation.path}`);
  }
  return parsed;
}
