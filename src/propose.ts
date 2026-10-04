import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadConfig } from "./config.js";
import { copyBaseWiki, copyWorkingWiki, resolveBase } from "./snapshot.js";
import type { Case, Config } from "./types.js";

interface Entry { path: string; question: string; answer: string; quote: string; questionOrigin: "explicit" | "heading" }

// Explicit Q/A blocks give the generator a reviewable expected answer without guessing from prose.
function parseEntries(path: string, body: string): Entry[] {
  const lines = body.split(/\r?\n/);
  const entries: Entry[] = [];
  let heading: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const title = /^#{1,6}\s+(.+?)\s*$/.exec(lines[i] ?? "")?.[1];
    if (title) { heading = title; continue; }
    const question = /^Question:\s*(.+?)\s*$/i.exec(lines[i] ?? "")?.[1];
    if (!question) {
      const line = lines[i] ?? "";
      const answer = /^Answer:\s*(.+?)\s*$/i.exec(line)?.[1];
      if (answer && heading) entries.push({
        path, question: `What does the wiki say about ${heading.charAt(0).toLocaleLowerCase()}${heading.slice(1).replace(/[?.!]$/, "")}?`,
        answer, quote: line, questionOrigin: "heading",
      });
      continue;
    }
    let next = i + 1;
    while (next < lines.length && !lines[next]?.trim()) next++;
    const line = lines[next] ?? "";
    const answer = /^Answer:\s*(.+?)\s*$/i.exec(line)?.[1];
    if (answer) {
      entries.push({ path, question, answer, quote: line, questionOrigin: "explicit" });
      i = next;
    }
  }
  return entries;
}

async function collect(root: string): Promise<Map<string, Entry>> {
  const entries = new Map<string, Entry>();
  async function walk(directory: string): Promise<void> {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile() && /\.md$/i.test(item.name)) {
        const rel = relative(root, path).split("\\").join("/");
        for (const entry of parseEntries(rel, await readFile(path, "utf8"))) {
          const key = `${rel}\0${entry.question}`;
          if (entries.has(key)) throw new Error(`Duplicate Question block in ${rel}`);
          entries.set(key, entry);
        }
      }
    }
  }
  await walk(root);
  return entries;
}

function slug(question: string): string {
  return question.toLocaleLowerCase("en").normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "fact";
}

export interface ProposalResult { config: Config; added: number; skipped: number; base: string }

export async function propose(repo: string, configPath: string, base: string): Promise<ProposalResult> {
  const config = await loadConfig(configPath, true);
  const sha = await resolveBase(repo, base);
  const temporary = await mkdtemp(join(tmpdir(), "brain-ci-propose-"));
  try {
    const beforeRoot = join(temporary, "before");
    const afterRoot = join(temporary, "after");
    await copyBaseWiki(repo, sha, config.wiki, beforeRoot);
    await copyWorkingWiki(repo, config.wiki, afterRoot);
    const before = await collect(beforeRoot);
    const after = await collect(afterRoot);
    const cases: Case[] = [...config.cases];
    const usedIds = new Set(cases.map((item) => item.id));
    const coveredQuestions = new Set(cases.map((item) => item.question));
    let added = 0;
    let skipped = 0;
    for (const [key, current] of after) {
      const previous = before.get(key);
      if (!previous || previous.answer === current.answer) continue;
      if (coveredQuestions.has(current.question)) { skipped++; continue; }
      const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
      const id = `${slug(current.question)}-${hash}`;
      if (usedIds.has(id)) { skipped++; continue; }
      // A previous value contained in the new value can be a legitimate historical statement.
      const forbid = current.answer.toLocaleLowerCase().includes(previous.answer.toLocaleLowerCase()) ? [] : [previous.answer];
      cases.push({
        id,
        question: current.question,
        expectation: { kind: "change", to: current.answer, ...(forbid.length ? { forbid } : {}) },
        source: { path: current.path, before: previous.quote, after: current.quote, questionOrigin: current.questionOrigin },
      });
      usedIds.add(id);
      coveredQuestions.add(current.question);
      added++;
    }
    return { config: { ...config, cases }, added, skipped, base: sha };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
