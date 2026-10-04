import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ask } from "./adapter.js";
import { inside, loadConfig } from "./config.js";
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
  probe?: "stale";
}

export async function check(options: CheckOptions): Promise<Report> {
  const config = await loadConfig(options.config);
  const calls = config.cases.length + (options.probe === "stale" ? config.cases.filter((item) => item.source?.before && item.expectation.kind === "change").length : 0);
  if (options.judge === "typesafe" && calls > options.maxCalls) {
    throw new Error(`Cost guard: ${calls} cases exceed --max-calls ${options.maxCalls}`);
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
        ? await judgeTypeSafe(before, after, item.expectation, item.question)
        : await judgeExact(before, after, item.expectation);
      results.push({ ...item, before, after, ...judgment, judge: options.judge });
      if (options.probe === "stale" && item.source && item.expectation.kind === "change") {
        const previousSource = inside(beforeRoot, item.source.path);
        const currentSource = inside(afterRoot, item.source.path);
        const [previousText, currentText] = await Promise.all([readFile(previousSource, "utf8"), readFile(currentSource, "utf8")]);
        if (!previousText.includes(item.source.before) || !currentText.includes(item.source.after)) {
          throw new Error(`Case ${item.id} source provenance no longer matches the selected snapshots`);
        }
        const mutantRoot = join(temporary, `mutant-${results.length}`);
        await cp(afterRoot, mutantRoot, { recursive: true });
        const staleName = `${dirname(item.source.path)}/zz-brain-ci-stale-${item.id}.md`.replace(/^\.\//, "");
        const stalePath = inside(mutantRoot, staleName);
        await mkdir(dirname(stalePath), { recursive: true });
        await writeFile(stalePath, `# Historical source (superseded)\n\nQuestion: ${item.question}\n${item.source.before}\n`, { flag: "wx" });
        const mutated = await ask(config.adapter, options.repo, mutantRoot, item.question);
        const probeJudgment = options.judge === "typesafe"
          ? await judgeTypeSafe(after, mutated, item.expectation, item.question)
          : await judgeExact(after, mutated, item.expectation);
        results.push({ ...item, id: `${item.id}-stale`, scenario: "stale-probe", before: after, after: mutated, ...probeJudgment, judge: options.judge });
      }
    }
    return makeReport(sha, options.judge, results);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export { parseConfig } from "./config.js";
export { propose } from "./propose.js";
export { toMarkdown } from "./report.js";
export type { Answer, Case, CaseResult, Citation, Config, Report, Verdict } from "./types.js";
