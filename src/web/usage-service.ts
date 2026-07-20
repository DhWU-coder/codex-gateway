import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const USAGE_SCHEMA_VERSION = "codex-usage.project-log.v1";

export interface UsageCounters {
  total: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

export interface UsageDashboardGroup {
  name: string;
  requests: number;
  usage: UsageCounters;
}

export interface UsageDashboardRecentItem {
  timestamp: string;
  provider: string;
  model: string;
  cwd: string;
  requestId: string;
  sessionId: string;
  usage: UsageCounters;
}

export interface UsageDashboardTimelineItem {
  key: string;
  requests: number;
  usage: UsageCounters;
}

export type UsageRangePreset = "today" | "week" | "month" | "all" | "recent" | "custom";
export type UsageBucket = "day" | "week" | "month";

export interface UsageDashboardOptions {
  projectRoot: string;
  preset?: string;
  recentValue?: string;
  startDate?: string;
  endDate?: string;
  bucket?: string;
  now?: string;
  recentLimit?: number;
}

export interface UsageDashboard {
  projectRoot: string;
  logPath: string;
  generatedAt: string;
  invalidLines: number;
  range: {
    preset: UsageRangePreset;
    start: string | null;
    end: string | null;
    bucket: UsageBucket;
  };
  totalRequests: number;
  totals: UsageCounters;
  byModel: UsageDashboardGroup[];
  byCwd: UsageDashboardGroup[];
  timeline: UsageDashboardTimelineItem[];
  recent: UsageDashboardRecentItem[];
}

interface UsageEvent extends UsageDashboardRecentItem {}

interface ResolvedRange {
  preset: UsageRangePreset;
  start: Date | null;
  end: Date | null;
  bucket: UsageBucket;
}

export function getUsageDashboard(options: UsageDashboardOptions): UsageDashboard {
  const projectRoot = resolve(options.projectRoot);
  const logPath = join(projectRoot, ".codex-usage", "usage.jsonl");
  const parsed = readUsageEvents(logPath);
  const range = resolveRange(options, parsed.events);
  const events = parsed.events.filter((event) => inRange(event.timestamp, range));
  const totals = emptyCounters();
  const byModel = new Map<string, UsageDashboardGroup>();
  const byCwd = new Map<string, UsageDashboardGroup>();
  const timeline = new Map<string, UsageDashboardTimelineItem>();

  for (const event of events) {
    addCounters(totals, event.usage);
    addGroup(byModel, event.model, event.usage);
    addGroup(byCwd, event.cwd, event.usage);
    addTimeline(timeline, bucketKey(event.timestamp, range.bucket), event.usage);
  }

  return {
    projectRoot,
    logPath,
    generatedAt: new Date().toISOString(),
    invalidLines: parsed.invalidLines,
    range: {
      preset: range.preset,
      start: range.start?.toISOString() ?? null,
      end: range.end?.toISOString() ?? null,
      bucket: range.bucket,
    },
    totalRequests: events.length,
    totals,
    byModel: sortedGroups(byModel),
    byCwd: sortedGroups(byCwd),
    timeline: Array.from(timeline.values()).sort((left, right) => left.key.localeCompare(right.key)),
    recent: [...events]
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, normalizeRecentLimit(options.recentLimit)),
  };
}

function readUsageEvents(logPath: string): { events: UsageEvent[]; invalidLines: number } {
  if (!existsSync(logPath)) return { events: [], invalidLines: 0 };
  const events: UsageEvent[] = [];
  let invalidLines = 0;
  for (const rawLine of readFileSync(logPath, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseUsageEvent(line);
    if (event) events.push(event);
    else invalidLines += 1;
  }
  return { events, invalidLines };
}

function parseUsageEvent(line: string): UsageEvent | undefined {
  try {
    const value = JSON.parse(line);
    if (!isRecord(value) || value.schema_version !== USAGE_SCHEMA_VERSION) return undefined;
    const timestamp = readString(value.timestamp);
    const usage = normalizeCounters(value.usage);
    if (!timestamp || !Number.isFinite(Date.parse(timestamp)) || !usage) return undefined;
    return {
      timestamp,
      provider: readString(value.provider) ?? "openai-codex",
      model: readString(value.model) ?? "unknown",
      cwd: readString(value.cwd) ?? "unknown",
      requestId: readString(value.request_id) ?? "",
      sessionId: readString(value.session_id) ?? "",
      usage,
    };
  } catch {
    return undefined;
  }
}

function normalizeCounters(value: unknown): UsageCounters | undefined {
  if (!isRecord(value)) return undefined;
  const total = readCounter(value.total);
  const input = readCounter(value.input);
  const output = readCounter(value.output);
  if (total === undefined || input === undefined || output === undefined) return undefined;
  return {
    total,
    input,
    cached: readCounter(value.cached) ?? 0,
    output,
    reasoning: readCounter(value.reasoning) ?? 0,
  };
}

function resolveRange(options: UsageDashboardOptions, events: UsageEvent[]): ResolvedRange {
  const preset = normalizePreset(options.preset);
  const bucket = normalizeBucket(options.bucket);
  const now = validDate(options.now) ?? new Date();
  if (preset === "today") {
    return { preset, bucket, start: startOfDay(now), end: endOfDay(now) };
  }
  if (preset === "week") {
    return { preset, bucket, start: startOfWeek(now), end: endOfDay(now) };
  }
  if (preset === "month") {
    return {
      preset,
      bucket,
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: endOfDay(now),
    };
  }
  if (preset === "custom") {
    return {
      preset,
      bucket,
      start: parseLocalDate(options.startDate, false),
      end: parseLocalDate(options.endDate, true),
    };
  }
  if (preset === "recent") {
    const days = normalizeRecentDays(options.recentValue);
    const start = startOfDay(now);
    start.setDate(start.getDate() - days + 1);
    return { preset, bucket, start, end: endOfDay(now) };
  }
  const timestamps = events
    .map((event) => Date.parse(event.timestamp))
    .filter(Number.isFinite);
  return {
    preset: "all",
    bucket,
    start: timestamps.length ? startOfDay(new Date(Math.min(...timestamps))) : null,
    end: timestamps.length ? endOfDay(new Date(Math.max(...timestamps))) : null,
  };
}

function inRange(timestamp: string, range: ResolvedRange): boolean {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return false;
  if (range.start && time < range.start.getTime()) return false;
  if (range.end && time > range.end.getTime()) return false;
  return true;
}

function addGroup(
  groups: Map<string, UsageDashboardGroup>,
  name: string,
  usage: UsageCounters
): void {
  const existing = groups.get(name) ?? { name, requests: 0, usage: emptyCounters() };
  existing.requests += 1;
  addCounters(existing.usage, usage);
  groups.set(name, existing);
}

function addTimeline(
  timeline: Map<string, UsageDashboardTimelineItem>,
  key: string,
  usage: UsageCounters
): void {
  const existing = timeline.get(key) ?? { key, requests: 0, usage: emptyCounters() };
  existing.requests += 1;
  addCounters(existing.usage, usage);
  timeline.set(key, existing);
}

function sortedGroups(groups: Map<string, UsageDashboardGroup>): UsageDashboardGroup[] {
  return Array.from(groups.values()).sort(
    (left, right) => right.usage.total - left.usage.total || left.name.localeCompare(right.name)
  );
}

function addCounters(target: UsageCounters, source: UsageCounters): void {
  target.total += source.total;
  target.input += source.input;
  target.cached += source.cached;
  target.output += source.output;
  target.reasoning += source.reasoning;
}

function emptyCounters(): UsageCounters {
  return { total: 0, input: 0, cached: 0, output: 0, reasoning: 0 };
}

function bucketKey(timestamp: string, bucket: UsageBucket): string {
  const date = new Date(timestamp);
  if (bucket === "month") return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  if (bucket === "week") {
    const week = startOfWeek(date);
    return `${week.getFullYear()}-${pad(week.getMonth() + 1)}-${pad(week.getDate())}`;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizePreset(value: string | undefined): UsageRangePreset {
  if (
    value === "today" ||
    value === "week" ||
    value === "month" ||
    value === "recent" ||
    value === "custom"
  ) {
    return value;
  }
  return "all";
}

function normalizeBucket(value: string | undefined): UsageBucket {
  return value === "week" || value === "month" ? value : "day";
}

function normalizeRecentDays(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "7", 10);
  return Number.isFinite(parsed) ? Math.min(365, Math.max(1, parsed)) : 7;
}

function normalizeRecentLimit(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.floor(value!))) : 20;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

function startOfWeek(value: Date): Date {
  const date = startOfDay(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function parseLocalDate(value: string | undefined, end: boolean): Date | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return null;
  }
  return end ? endOfDay(date) : date;
}

function validDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function readCounter(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
