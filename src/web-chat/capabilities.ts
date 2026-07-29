import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  CodexStructuredInput,
} from "../codex/runner.js";
import type { SessionReference } from "../session/history.js";

export type WebChatCapabilityKind =
  | "file"
  | "directory"
  | "skill"
  | "plugin"
  | "app";

export interface WebChatCapabilityPublic {
  id: string;
  name: string;
  kind: WebChatCapabilityKind;
  description?: string;
}

export interface WebChatCapabilityRuntime {
  listSkills(cwd: string): Promise<unknown[]>;
  listInstalledPlugins(cwd: string): Promise<unknown[]>;
  listInstalledApps(threadId?: string): Promise<unknown[]>;
  searchFiles(cwd: string, query: string): Promise<unknown[]>;
}

export interface ResolvedWebChatCapabilities {
  structuredInput: CodexStructuredInput[];
  additionalContext: Record<
    string,
    { value: string; kind: "application" | "untrusted" }
  >;
  references: SessionReference[];
}

export interface WebChatCapabilityCatalogOptions {
  runtime: WebChatCapabilityRuntime;
  now?: () => number;
  ttlMs?: number;
  createId?: () => string;
}

interface CapabilityRecord extends WebChatCapabilityPublic {
  userId: string;
  cwd: string;
  expiresAt: number;
  path?: string;
  applicationId?: string;
}

export class WebChatCapabilityCatalog {
  private readonly runtime: WebChatCapabilityRuntime;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly createId: () => string;
  private readonly records = new Map<string, CapabilityRecord>();

  constructor(options: WebChatCapabilityCatalogOptions) {
    this.runtime = options.runtime;
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = Math.max(1, options.ttlMs ?? 5 * 60_000);
    this.createId =
      options.createId ?? (() => `capability-${randomUUID()}`);
  }

  async list(
    userId: string,
    cwd: string,
    threadId?: string
  ): Promise<WebChatCapabilityPublic[]> {
    this.prune();
    const [skillEntries, plugins, apps] = await Promise.all([
      this.runtime.listSkills(cwd),
      this.runtime.listInstalledPlugins(cwd),
      this.runtime.listInstalledApps(threadId),
    ]);
    const result: WebChatCapabilityPublic[] = [];

    for (const entry of skillEntries) {
      const item = asRecord(entry);
      if (!Array.isArray(item?.skills)) continue;
      for (const skill of item.skills) {
        const value = asRecord(skill);
        if (!value || value.enabled !== true) continue;
        const name = stringValue(value.name);
        const path = stringValue(value.path);
        if (!name || !path) continue;
        result.push(
          this.remember({
            userId,
            cwd,
            name,
            kind: "skill",
            path,
            description:
              stringValue(value.shortDescription)
              || stringValue(value.description)
              || undefined,
          })
        );
      }
    }

    for (const plugin of plugins) {
      const value = asRecord(plugin);
      if (!value) continue;
      const name = stringValue(value.name) || stringValue(value.id);
      const applicationId = stringValue(value.id);
      if (!name || !applicationId) continue;
      result.push(
        this.remember({
          userId,
          cwd,
          name,
          kind: "plugin",
          applicationId,
          description: publicDescription(value.interface),
        })
      );
    }

    for (const app of apps) {
      const value = asRecord(app);
      if (!value || value.enabled !== true || value.callable !== true) continue;
      const applicationId = stringValue(value.id);
      const name = stringValue(value.runtimeName) || applicationId;
      if (!applicationId || !name) continue;
      result.push(
        this.remember({
          userId,
          cwd,
          name,
          kind: "app",
          applicationId,
          description: "已安装并启用的 Codex 应用",
        })
      );
    }
    return result;
  }

  async searchFiles(
    userId: string,
    cwd: string,
    query: string
  ): Promise<WebChatCapabilityPublic[]> {
    this.prune();
    const files = await this.runtime.searchFiles(cwd, query);
    return files.flatMap((file) => {
      const value = asRecord(file);
      if (!value) return [];
      const path = stringValue(value.path);
      const root = stringValue(value.root) || cwd;
      const name = stringValue(value.file_name) || path.split("/").at(-1) || path;
      if (!path || !name) return [];
      const matchType = stringValue(value.match_type).toLowerCase();
      return [
        this.remember({
          userId,
          cwd,
          name,
          kind: matchType.includes("directory") ? "directory" : "file",
          path: isAbsolute(path) ? path : resolve(root, path),
          description: relative(cwd, isAbsolute(path) ? path : resolve(root, path)),
        }),
      ];
    });
  }

  resolve(
    userId: string,
    cwd: string,
    ids: string[]
  ): ResolvedWebChatCapabilities {
    const structuredInput: CodexStructuredInput[] = [];
    const additionalContext: ResolvedWebChatCapabilities["additionalContext"] = {};
    const references: SessionReference[] = [];

    for (const id of [...new Set(ids)]) {
      const record = this.records.get(id);
      if (!record || record.userId !== userId || record.cwd !== cwd) {
        throw new Error("所选能力不可用，请重新选择。");
      }
      if (record.expiresAt <= this.now()) {
        this.records.delete(id);
        throw new Error("所选能力已过期，请重新选择。");
      }
      references.push({
        id: record.id,
        name: record.name,
        kind: record.kind,
      });
      if (record.kind === "skill" && record.path) {
        structuredInput.push({
          type: "skill",
          name: record.name,
          path: record.path,
        });
        continue;
      }
      if (
        (record.kind === "file" || record.kind === "directory")
        && record.path
      ) {
        if (!isWithin(cwd, record.path)) {
          throw new Error("所选文件不在当前用户工作区内。");
        }
        structuredInput.push({
          type: "mention",
          name: record.name,
          path: record.path,
        });
        continue;
      }
      additionalContext[`capability:${record.id}`] = {
        kind: "application",
        value: `${record.kind === "plugin" ? "插件" : "应用"}：${record.name}（${record.applicationId ?? record.id}）`,
      };
    }
    return { structuredInput, additionalContext, references };
  }

  private remember(
    input: Omit<CapabilityRecord, "id" | "expiresAt">
  ): WebChatCapabilityPublic {
    const record: CapabilityRecord = {
      ...input,
      id: this.createId(),
      expiresAt: this.now() + this.ttlMs,
    };
    this.records.set(record.id, record);
    return {
      id: record.id,
      name: record.name,
      kind: record.kind,
      ...(record.description ? { description: record.description } : {}),
    };
  }

  private prune(): void {
    const now = this.now();
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(id);
    }
  }
}

function isWithin(root: string, path: string): boolean {
  const relation = relative(resolve(root), resolve(path));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function publicDescription(value: unknown): string | undefined {
  const item = asRecord(value);
  return (
    stringValue(item?.shortDescription)
    || stringValue(item?.description)
    || undefined
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
