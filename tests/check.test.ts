import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { check, parseConfig, toMarkdown } from "../src/index.js";

const run = promisify(execFile);

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), "brain-ci-test-"));
  await run("git", ["init", "-q", "-b", "main", repo]);
  await run("git", ["config", "user.name", "Brain CI Test"], { cwd: repo });
  await run("git", ["config", "user.email", "brain-ci@example.invalid"], { cwd: repo });
  await mkdir(join(repo, "wiki"));
  await writeFile(join(repo, "wiki", "policy.md"), "Answer: 30 days\n");
  await writeFile(join(repo, "ask.mjs"), `
    import { readFile } from 'node:fs/promises';
    import { join } from 'node:path';
    const text = await readFile(join(process.env.BRAIN_CI_WIKI, 'policy.md'), 'utf8');
    const answer = text.match(/Answer: (.+)/)[1];
    process.stdout.write(JSON.stringify({ answer, citations: [{ path: 'policy.md', quote: 'Answer: ' + answer }] }));
  `);
  const config = join(repo, "brain-ci.json");
  const makeConfig = (expectation: object) => writeFile(config, JSON.stringify({
    version: 1, wiki: "wiki", adapter: ["node", "ask.mjs"],
    cases: [{ id: "refund", question: "Refund window?", expectation }],
  }));
  await makeConfig({ kind: "change", to: "14 days" });
  await run("git", ["add", "."], { cwd: repo });
  await run("git", ["commit", "-qm", "Initial policy"], { cwd: repo });
  await writeFile(join(repo, "wiki", "policy.md"), "Answer: 14 days\n");
  return { repo, config, makeConfig, cleanup: () => rm(repo, { recursive: true, force: true }) };
}

test("compares a Git base to the working wiki and verifies citations", async () => {
  const f = await fixture();
  try {
    const report = await check({ repo: f.repo, config: f.config, base: "HEAD", judge: "exact", maxCalls: 0 });
    assert.deepEqual(report.counts, { pass: 1, regression: 0, review: 0 });
    assert.equal(report.results[0]?.before.answer, "30 days");
    assert.equal(report.results[0]?.after.answer, "14 days");
    assert.match(toMarkdown(report), /30 days/);
  } finally { await f.cleanup(); }
});

test("changed preserve case becomes review offline", async () => {
  const f = await fixture();
  try {
    await f.makeConfig({ kind: "preserve" });
    const report = await check({ repo: f.repo, config: f.config, base: "HEAD", judge: "exact", maxCalls: 0 });
    assert.equal(report.counts.review, 1);
  } finally { await f.cleanup(); }
});

test("rejects citation without an exact quote", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.repo, "ask.mjs"), `
      process.stdout.write(JSON.stringify({answer:'14 days',citations:[{path:'policy.md',quote:'invented'}]}));
    `);
    await assert.rejects(check({ repo: f.repo, config: f.config, base: "HEAD", judge: "exact", maxCalls: 0 }), /Citation quote not found/);
  } finally { await f.cleanup(); }
});

test("validates paths, IDs and cost guard before running", async () => {
  assert.throws(() => parseConfig({ version: 1, wiki: "../private", adapter: ["node"], cases: [] }), /safe relative/);
  const f = await fixture();
  try {
    await assert.rejects(check({ repo: f.repo, config: f.config, base: "HEAD", judge: "typesafe", maxCalls: 0 }), /Cost guard/);
  } finally { await f.cleanup(); }
});
