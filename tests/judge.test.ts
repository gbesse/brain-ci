import assert from "node:assert/strict";
import test from "node:test";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { judgeTypeSafe } from "../src/judge.js";
import type { Answer } from "../src/types.js";

const answer = (text: string): Answer => ({ answer: text, citations: [] });

test("Jev judgment receives the question and records model and usage", async () => {
  let state: unknown;
  const client = {
    systemOne: async (request: { state: unknown }) => {
      state = request.state;
      return {
        model: "jev-test",
        usage: { input_tokens: 42, output_tokens: 0 },
        answers: { verdict: { type: "choice", choice: "regression", confidence: 0.96 } },
      };
    },
  } as unknown as TypeSafeClient;
  const result = await judgeTypeSafe(answer("30 days"), answer("14 days"), { kind: "preserve" }, "What is the refund window?", client);
  assert.equal(result.verdict, "regression");
  assert.equal(result.model, "jev-test");
  assert.equal(result.inputTokens, 42);
  assert.deepEqual(state, {
    question: "What is the refund window?",
    old_answer: "30 days",
    new_answer: "14 days",
    expected_new_answer: null,
  });
});

test("low Jev confidence requests review and oversized input makes no call", async () => {
  let calls = 0;
  const client = {
    systemOne: async () => {
      calls++;
      return {
        model: "jev-test",
        usage: { input_tokens: 17, output_tokens: 0 },
        answers: { verdict: { type: "choice", choice: "pass", confidence: 0.6 } },
      };
    },
  } as unknown as TypeSafeClient;
  const uncertain = await judgeTypeSafe(answer("old"), answer("new"), { kind: "preserve" }, "What changed?", client);
  assert.equal(uncertain.verdict, "review");
  assert.equal(uncertain.model, "jev-test");
  await assert.rejects(
    judgeTypeSafe(answer("old"), answer("new"), { kind: "preserve" }, "x".repeat(16_001), client),
    /exceeds 16000 characters/,
  );
  assert.equal(calls, 1);
});
