import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { check, parseConfig, propose, toMarkdown } from "../src/index.js";

const run = promisify(execFile);

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), "brain-ci-propose-test-"));
  await run("git", ["init", "-q", "-b", "main", repo]);
  await run("git", ["config", "user.name", "Brain CI Test"], { cwd: repo });
  await run("git", ["config", "user.email", "brain-ci@example.invalid"], { cwd: repo });
  await mkdir(join(repo, "wiki"));
  await writeFile(join(repo, "wiki", "refund.md"), "# Refunds\n\nQuestion: What is the refund window?\nAnswer: 30 days\n");
  await writeFile(join(repo, "ask.mjs"), `
    import { readFile, readdir } from 'node:fs/promises';
    import { join } from 'node:path';
    const files = (await readdir(process.env.BRAIN_CI_WIKI)).filter(x => x.endsWith('.md')).sort();
    const path = files.at(-1);
    const body = await readFile(join(process.env.BRAIN_CI_WIKI, path), 'utf8');
    const quote = body.match(/^Answer: .+$/m)[0];
    process.stdout.write(JSON.stringify({answer: quote.slice(8), citations: [{path, quote}]}));
  `);
  const config = join(repo, "brain-ci.json");
  await writeFile(config, JSON.stringify({
    version: 1, wiki: "wiki", adapter: ["node", "ask.mjs"],
    cases: [{ id: "existing", question: "Unrelated question?", expectation: { kind: "preserve" } }],
  }));
  await run("git", ["add", "."], { cwd: repo });
  await run("git", ["commit", "-qm", "Initial brain"], { cwd: repo });
  await writeFile(join(repo, "wiki", "refund.md"), "# Refunds\n\nQuestion: What is the refund window?\nAnswer: 14 days\n");
  return { repo, config, cleanup: () => rm(repo, { recursive: true, force: true }) };
}

test("proposes a source-backed contract from a changed explicit Q/A block", async () => {
  const f = await fixture();
  try {
    const result = await propose(f.repo, f.config, "HEAD");
    assert.equal(result.added, 1);
    const generated = result.config.cases[1]!;
    assert.match(generated.id, /^what-is-the-refund-window-[0-9a-f]{8}$/);
    assert.deepEqual(generated.expectation, { kind: "change", to: "14 days", forbid: ["30 days"] });
    assert.deepEqual(generated.source, { path: "refund.md", before: "Answer: 30 days", after: "Answer: 14 days", questionOrigin: "explicit" });
    parseConfig(result.config);
    const repeated = await propose(f.repo, f.config, "HEAD");
    assert.equal(repeated.config.cases[1]?.id, generated.id);
    await writeFile(f.config, JSON.stringify({ ...result.config, cases: [generated] }));
    await assert.rejects(
      check({ repo: f.repo, config: f.config, base: "HEAD", judge: "typesafe", maxCalls: 1, probe: "stale" }),
      /Cost guard: 2 cases/,
    );
    const report = await check({ repo: f.repo, config: f.config, base: "HEAD", judge: "exact", maxCalls: 0 });
    assert.equal(report.counts.pass, 1);
    const stale = await check({ repo: f.repo, config: f.config, base: "HEAD", judge: "exact", maxCalls: 0, probe: "stale" });
    assert.deepEqual(stale.counts, { pass: 1, regression: 1, review: 0 });
    assert.equal(stale.results[1]?.scenario, "stale-probe");
    assert.match(stale.results[1]!.reason, /forbidden previous value/);
    assert.match(toMarkdown(stale), /Previous source:/);
    assert.match(toMarkdown(stale), /Head with a superseded source reintroduced/);
    await assert.rejects(readFile(join(f.repo, "wiki", "zz-brain-ci-stale-" + generated.id + ".md"), "utf8"));
  } finally { await f.cleanup(); }
});

test("does not invent contracts for prose or already covered questions", async () => {
  const f = await fixture();
  try {
    const raw = JSON.parse(await readFile(f.config, "utf8"));
    raw.cases[0].question = "What is the refund window?";
    await writeFile(f.config, JSON.stringify(raw));
    const covered = await propose(f.repo, f.config, "HEAD");
    assert.equal(covered.added, 0);
    assert.equal(covered.skipped, 1);
    await writeFile(join(f.repo, "wiki", "refund.md"), "# Refunds\nThe window is now 14 days.\n");
    const prose = await propose(f.repo, f.config, "HEAD");
    assert.equal(prose.added, 0);
  } finally { await f.cleanup(); }
});

test("CLI writes a runnable proposed config", async () => {
  const f = await fixture();
  try {
    const cli = join(import.meta.dirname, "..", "src", "cli.ts");
    const output = join(f.repo, "proposed.json");
    await run(process.execPath, ["--import", "tsx", cli, "propose", "--base", "HEAD", "--config", "brain-ci.json", "--repo", f.repo, "--out", output], {
      cwd: join(import.meta.dirname, ".."),
    });
    const proposed = parseConfig(JSON.parse(await readFile(output, "utf8")));
    assert.equal(proposed.cases.length, 2);
  } finally { await f.cleanup(); }
});

test("infers a reviewable question from a stable Markdown heading", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.repo, "wiki", "refund.md"), "# Refunds\n\nAnswer: 14 days\n");
    await run("git", ["add", "wiki/refund.md"], { cwd: f.repo });
    await run("git", ["commit", "-qm", "Heading-only base"], { cwd: f.repo });
    await writeFile(join(f.repo, "wiki", "refund.md"), "# Refunds\n\nAnswer: 7 days\n");
    await writeFile(f.config, JSON.stringify({ version: 1, wiki: "wiki", adapter: ["node", "ask.mjs"], cases: [] }));
    const result = await propose(f.repo, f.config, "HEAD");
    assert.equal(result.added, 1);
    assert.equal(result.config.cases[0]?.question, "What does the wiki say about refunds?");
    assert.equal(result.config.cases[0]?.source?.questionOrigin, "heading");
  } finally { await f.cleanup(); }
});
