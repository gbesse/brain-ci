# Brain CI

**Regression checks for a versioned agent brain.** Ask the same questions of a Git baseline and your working knowledge base, verify the cited passages, and review what changed before merging.

```text
Git base wiki ──▶ your query adapter ──▶ answer + citations ──┐
                                                           ├──▶ Brain CI report
Working wiki ──▶ your query adapter ──▶ answer + citations ─┘
                                      exact or Jev judge
```

Brain CI is a test runner, not a memory store or answer generator. It works with a query command that implements the small JSON adapter contract below. The bundled adapter is deterministic and only demonstrates the protocol. For real questions, your adapter must query the wiki snapshot supplied by Brain CI. A GBrain adapter would need to load each snapshot into an isolated brain; querying the same live GBrain store twice would give an invalid comparison.

## Try the example

Requires Node.js 22+, Git, and a repository with a baseline commit. The example in this repository changes a refund window from 30 to 14 days; the `demo-baseline` tag pins the 30-day version.

```bash
npm ci
npm run build
node dist/cli.js propose \
  --base demo-baseline \
  --config examples/refund-wiki/brain-ci.json \
  --out reports/proposed.json
node dist/cli.js check \
  --base demo-baseline \
  --config reports/proposed.json \
  --markdown reports/refund.md \
  --json reports/refund.json
```

`propose` reads the Git base and working wiki and adds candidate cases when an existing Markdown question/answer block changes. This example also derives a candidate question from the `# Refund policy` heading. Open `reports/proposed.json` to review its question, expected answer, forbidden old value, and source passages before using it as a CI config. No API key is needed to propose or run the exact judge.

## Generate cases from a wiki diff

Use `brain-ci propose --base origin/main --config brain-ci.json --out proposed.json` from your brain repository. A page can contain an explicit pair:

```markdown
Question: What is the refund window?
Answer: Refunds are available within 14 days of purchase.
```

If a heading has an `Answer:` line without a `Question:` line, the generator drafts a question from the heading and marks `source.questionOrigin` as `heading`. It compares only a question already present at the same path in the Git base. New and deleted questions and freeform prose do not produce contracts; duplicate questions within one file cause an error. A config with `"cases": []` is accepted by `propose`; `check` requires at least one case.

The output is a complete config. Review the added cases and commit the approved config, then run `brain-ci check --base origin/main --config brain-ci.json` in CI. Generated cases include `expectation.forbid` with the previous answer when that text is absent from the new answer. If an agent answers with the old value, the exact judge reports a regression. Remove or narrow `forbid` when historical context is allowed in a current answer; the check is a literal case-insensitive substring match. Existing cases with the same question are kept, and no duplicate is proposed.

Add `--probe stale` to `check` to copy the working wiki into a disposable snapshot, reintroduce the superseded answer as a clearly labeled historical Markdown page, and ask the adapter again. Each generated case with source provenance gets a second report row. The source passages are checked against the selected snapshots before the probe runs. The example adapter deliberately picks the last Markdown page, so this command exits `1` with a detected regression:

```bash
node dist/cli.js check \
  --base demo-baseline \
  --config reports/proposed.json \
  --probe stale
```

This probe tests one failure mode. Passing it means the adapter handled this injected historical page; it does not prove that all stale sources, user scopes, or deletions are safe. The injected page is removed with the temporary snapshot, and no source file in the repository is changed.

The default `exact` judge makes no network calls. It accepts an exact normalized match and sends other changes to review. To compare meaning with Jev:

```bash
node --env-file=.env dist/cli.js check \
  --base demo-baseline \
  --config examples/refund-wiki/brain-ci.json \
  --judge typesafe \
  --max-calls 5 \
  --markdown reports/refund.md
```

The `.env` file must be ignored by Git and contain `TYPESAFE_API_KEY`. One Jev HTTP attempt is made per case, up to `--max-calls`; automatic retries are disabled for this cost guard. The runner sends the question, old answer, new answer, and expected new answer to TypeSafe. It does not send wiki snapshots directly, although an adapter answer may itself contain source text. Jev input is capped at 16,000 characters per case. The report records the model and input token count returned by TypeSafe.

## Compare expected and unexpected changes offline

Run `npm run demo:verdicts` to create a temporary synthetic Git wiki, change its refund window, and see why the exact judge returns `pass` for a declared change but `review` for an undeclared one. The example removes its temporary files and uses no Jev key or network call.

## Configure a brain

Create `brain-ci.json` in your brain's Git repository:

```json
{
  "version": 1,
  "wiki": "wiki",
  "adapter": ["node", "scripts/ask-brain.mjs"],
  "cases": [
    {
      "id": "refund-window",
      "question": "What is the refund window?",
      "expectation": { "kind": "change", "to": "Refunds are available within 14 days of purchase." }
    },
    {
      "id": "support-hours",
      "question": "When is support available?",
      "expectation": { "kind": "preserve" }
    }
  ]
}
```

Run `brain-ci check --base origin/main --config brain-ci.json` from that repository. The base must be a local Git commit or ref. The head is the current working tree, so uncommitted wiki edits are included. Only the configured wiki directory is snapshotted. The adapter command runs from the repository root.

Each adapter invocation receives `{"question":"..."}` on stdin and the absolute snapshot directory in `BRAIN_CI_WIKI`. It must print exactly one JSON object on stdout:

```json
{
  "answer": "Refunds are available within 14 days of purchase.",
  "citations": [
    {
      "path": "refunds.md",
      "quote": "Answer: Refunds are available within 14 days of purchase."
    }
  ]
}
```

Citation paths are relative to the wiki directory. Each quote must appear verbatim in its file in the corresponding snapshot. A missing citation or an invalid quote stops the run. This is a mechanical check of provenance, not proof that the cited text supports the answer.

## Verdicts and CI

| Verdict | Meaning | Exit code |
| --- | --- | ---: |
| `pass` | Answer met the declared expectation. | `0` if all cases pass |
| `regression` | Jev found a substantive mismatch with sufficient confidence. | `1` |
| `review` | Exact text changed, or Jev was uncertain. | `2` |

Configuration errors, invalid citations and adapter failures also exit `2`. `--json` and `--markdown` write full answers and citations; those reports may contain private information. Paths under `reports/` are ignored by default in this repository. Set your own retention and access rules in other repositories.

Adapter stderr and malformed stdout are suppressed in errors by default because they may contain private source text. Set `BRAIN_CI_DEBUG=1` only when inspecting a failure locally; it includes a short stderr excerpt in the error.

For a pull request, fetch the base branch history (`actions/checkout` with `fetch-depth: 0`), install this package from a pinned Git commit, and run `brain-ci check --base origin/main --config brain-ci.json --judge exact`. Add `--judge typesafe` only after you approve sending the case answers to TypeSafe and configure the secret in CI. Brain CI never treats a Jev verdict as authorization to edit or publish memory.

## Design limits

- Jev compares meanings; it does not establish whether an answer is factually true. Human reviewed test cases and trustworthy source material remain necessary.
- A `preserve` case assumes the baseline answer is acceptable. A `change` case supplies the intended new answer.
- Jev's confidence is a routing signal. Brain CI sends results below `0.80` to `review`; this threshold is a starting default, not a calibrated guarantee for your corpus.
- The adapter is your trusted process. It should return stable answers for the same snapshot and question; otherwise response variance can look like a memory regression. It can perform its own network calls. Brain CI limits its runtime to 30 seconds per question, but does not sandbox it.
- Git snapshots cover regular files. Symlinks in the working wiki are rejected.

## Development

```bash
npm ci
npm run release:check
```

MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
