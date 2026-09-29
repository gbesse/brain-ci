import type { CaseResult, Report, Verdict } from "./types.js";

const html = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (value: string): string => html(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function quoted(value: string): string {
  return `<pre>${html(value.trim())}</pre>`;
}

function detail(result: CaseResult): string {
  const citations = (side: "before" | "after") => result[side].citations
    .map((citation) => `- <code>${html(citation.path)}</code>: ${inline(citation.quote)}`)
    .join("\n");
  return [
    `<details><summary>${result.id}: ${result.verdict}</summary>`,
    "",
    `**Question:** ${html(result.question)}`,
    "",
    "**Before**",
    "",
    quoted(result.before.answer),
    "",
    citations("before"),
    "",
    "**After**",
    "",
    quoted(result.after.answer),
    "",
    citations("after"),
    "",
    `**Verdict:** ${result.reason}${result.confidence === undefined ? "" : ` (confidence ${result.confidence.toFixed(2)})`}`,
    "",
    "</details>",
  ].join("\n");
}

export function makeReport(base: string, judge: "exact" | "typesafe", results: CaseResult[]): Report {
  const counts: Record<Verdict, number> = { pass: 0, regression: 0, review: 0 };
  for (const result of results) counts[result.verdict]++;
  return { schemaVersion: 1, base, head: "working-tree", judge, results, counts };
}

export function toMarkdown(report: Report): string {
  return [
    "# Brain CI report",
    "",
    `Base: \`${report.base.slice(0, 12)}\` · Head: working tree · Judge: ${report.judge}`,
    "",
    `**${report.counts.pass} pass · ${report.counts.regression} regression · ${report.counts.review} review**`,
    "",
    "| Case | Expectation | Verdict | Reason |",
    "| --- | --- | --- | --- |",
    ...report.results.map((result) => `| ${inline(result.id)} | ${result.expectation.kind} | ${result.verdict} | ${inline(result.reason)} |`),
    "",
    ...report.results.flatMap((result) => [detail(result), ""]),
  ].join("\n");
}
