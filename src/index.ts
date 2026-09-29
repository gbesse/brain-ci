import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ask } from "./adapter.js";
import { loadConfig } from "./config.js";
import { judgeExact, judgeTypeSafe } from "./judge.js";
import { makeReport } from "./report.js";
import { copyBaseWiki, copyWorkingWiki, resolveBase } from "./snapshot.js";
import type { CaseResult, Report } from "./types.js";

export interface CheckOptions {
  repo: string;
  config: string;
  base: string;
  judge: "exact" | "typesafe";
  maxCalls: number;
}

export async function check(options: CheckOptions): Promise<Report> {
  const config = await loadConfig(options.config);
  if (options.judge === "typesafe" && config.cases.length > options.maxCalls) {
    throw new Error(`Cost guard: ${config.cases.length} cases exceed --max-calls ${options.maxCalls}`);
  }
  if (options.judge === "typesafe" && !process.env.TYPESAFE_API_KEY) {
    throw new Error("TYPESAFE_API_KEY is required for --judge typesafe");
  }
  const sha = await resolveBase(options.repo, options.base);
  const temporary = await mkdtemp(join(tmpdir(), "brain-ci-"));
  const beforeRoot = join(temporary, "before");
  const afterRoot = join(temporary, "after");
  try {
    await copyBaseWiki(options.repo, sha, config.wiki, beforeRoot);
    await copyWorkingWiki(options.repo, config.wiki, afterRoot);
    const results: CaseResult[] = [];
    for (const item of config.cases) {
      const before = await ask(config.adapter, options.repo, beforeRoot, item.question);
      const after = await ask(config.adapter, options.repo, afterRoot, item.question);
      const judgment = options.judge === "typesafe"
        ? await judgeTypeSafe(before, after, item.expectation)
        : await judgeExact(before, after, item.expectation);
      results.push({ ...item, before, after, ...judgment, judge: options.judge });
    }
    return makeReport(sha, options.judge, results);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export { parseConfig } from "./config.js";
export { toMarkdown } from "./report.js";
export type { Answer, Case, CaseResult, Citation, Config, Report, Verdict } from "./types.js";
