export type Expectation =
  | { kind: "preserve" }
  | { kind: "change"; to: string };

export interface Case {
  id: string;
  question: string;
  expectation: Expectation;
}

export interface Config {
  version: 1;
  wiki: string;
  adapter: string[];
  cases: Case[];
}

export interface Citation {
  path: string;
  quote: string;
}

export interface Answer {
  answer: string;
  citations: Citation[];
}

export type Verdict = "pass" | "regression" | "review";

export interface CaseResult {
  id: string;
  question: string;
  expectation: Expectation;
  before: Answer;
  after: Answer;
  verdict: Verdict;
  reason: string;
  judge: "exact" | "typesafe";
  confidence?: number;
}

export interface Report {
  schemaVersion: 1;
  base: string;
  head: "working-tree";
  judge: "exact" | "typesafe";
  results: CaseResult[];
  counts: Record<Verdict, number>;
}
