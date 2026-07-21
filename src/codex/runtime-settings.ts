export const CODEX_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export const CODEX_VERBOSITIES = ["low", "medium", "high"] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];
export type CodexVerbosity = (typeof CODEX_VERBOSITIES)[number];

export interface CodexRuntimeTuning {
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
}

export function normalizeCodexReasoningEffort(
  value: unknown
): CodexReasoningEffort | undefined {
  return typeof value === "string" && CODEX_REASONING_EFFORTS.includes(value as CodexReasoningEffort)
    ? (value as CodexReasoningEffort)
    : undefined;
}

export function normalizeCodexVerbosity(value: unknown): CodexVerbosity | undefined {
  return typeof value === "string" && CODEX_VERBOSITIES.includes(value as CodexVerbosity)
    ? (value as CodexVerbosity)
    : undefined;
}
