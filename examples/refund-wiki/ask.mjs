// Tiny deterministic adapter for the demo. Replace this with your own agent or brain query command.
import { readFile } from "node:fs/promises";
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

const text = await readFile(join(process.env.BRAIN_CI_WIKI, "refunds.md"), "utf8");
const answer = text.match(/^Answer: (.+)$/m)?.[1];
if (!answer) throw new Error("Missing Answer line");
process.stdout.write(JSON.stringify({
  answer,
  citations: [{ path: "refunds.md", quote: `Answer: ${answer}` }],
}) + "\n");
