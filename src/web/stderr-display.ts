const omitted = Symbol("omitted-web-stderr-event");

const benignWarningPatterns = [
  /\bWARN\s+codex_core_skills::loader:\s+ignoring interface\.icon_(?:small|large):\s+icon path with '\.\.' must resolve under plugin assets\/\s*$/i,
  /\bWARN\s+codex_otel::events::session_telemetry:\s+metrics counter \[codex\.skill\.injected\] failed:\s+tag value contains invalid characters:\s+superpowers:using-superpowers\s*$/i,
];

export function filterCodexStderrForDisplay(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !benignWarningPatterns.some((pattern) => pattern.test(line.trim())))
    .join("\n")
    .trim();
}

export function filterChannelStatusForDisplay<T>(status: T): T {
  const filtered = filterDisplayValue(status);
  return (filtered === omitted ? status : filtered) as T;
}

function filterDisplayValue(value: unknown): unknown | typeof omitted {
  if (Array.isArray(value)) {
    return value
      .map((item) => filterDisplayValue(item))
      .filter((item) => item !== omitted);
  }
  if (!isRecord(value)) return value;

  if (value.type === "stderr" && typeof value.text === "string") {
    const text = filterCodexStderrForDisplay(value.text);
    if (!text) return omitted;
    return { ...value, text };
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const filtered = filterDisplayValue(item);
      return filtered === omitted ? [] : [[key, filtered]];
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
