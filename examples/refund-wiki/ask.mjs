// Intentionally naive retrieval: the stale-source probe demonstrates why a real adapter must resolve supersession.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const { question } = JSON.parse(await new Promise((resolve) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (part) => { input += part; });
  process.stdin.on("end", () => resolve(input));
}));

if (!/refund|remboursement/i.test(question)) {
  process.stderr.write("This demo adapter only answers refund questions.\n");
  process.exit(1);
}

const path = (await readdir(process.env.BRAIN_CI_WIKI)).filter((name) => name.endsWith(".md")).sort().at(-1);
if (!path) throw new Error("No Markdown page");
const text = await readFile(join(process.env.BRAIN_CI_WIKI, path), "utf8");
const answer = text.match(/^Answer: (.+)$/m)?.[1];
if (!answer) throw new Error("Missing Answer line");
process.stdout.write(JSON.stringify({
  answer,
  citations: [{ path, quote: `Answer: ${answer}` }],
}) + "\n");
