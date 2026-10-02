import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../dist/index.js';

const run = promisify(execFile);
const repo = await mkdtemp(join(tmpdir(), 'brain-ci-verdicts-'));
try {
  await run('git', ['init', '-q', '-b', 'main', repo]);
  await run('git', ['config', 'user.name', 'Synthetic Demo'], { cwd: repo });
  await run('git', ['config', 'user.email', 'demo@example.invalid'], { cwd: repo });
  await mkdir(join(repo, 'wiki'));
  const page = join(repo, 'wiki', 'refunds.md');
  await writeFile(page, 'Answer: Refunds are available within 30 days of purchase.\n');
  await writeFile(join(repo, 'ask.mjs'), await readFile(new URL('./refund-wiki/ask.mjs', import.meta.url)));
  await writeFile(join(repo, 'package.json'), '{"type":"module"}\n');
  await run('git', ['add', '.'], { cwd: repo });
  await run('git', ['commit', '-qm', 'Synthetic baseline'], { cwd: repo });
  await writeFile(page, 'Answer: Refunds are available within 14 days of purchase.\n');
  const config = join(repo, 'brain-ci.json');
  async function verdict(kind) {
    await writeFile(config, JSON.stringify({ version: 1, wiki: 'wiki', adapter: ['node', 'ask.mjs'], cases: [{ id: 'refund-window', question: 'What is the refund window?', expectation: kind === 'change' ? { kind, to: 'Refunds are available within 14 days of purchase.' } : { kind } }] }));
    const report = await check({ repo, config, base: 'HEAD', judge: 'exact', maxCalls: 0 });
    return report.results[0].verdict;
  }
  const expectedChange = await verdict('change');
  const unexpectedChange = await verdict('preserve');
  assert.equal(expectedChange, 'pass');
  assert.equal(unexpectedChange, 'review');
  console.log(JSON.stringify({ synthetic: true, expectedChange, unexpectedChange, judge: 'exact', networkCalls: 0 }, null, 2));
} finally {
  await rm(repo, { recursive: true, force: true });
}
