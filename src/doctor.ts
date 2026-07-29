import type { CodexAppServerRuntime } from "./codex/app-server-runtime.js";
import { sanitizeServiceDiagnostic } from "./service/daemon.js";

export type CodexAppServerDoctorReport =
  | {
      protocol: "ok";
      models: number;
      skills: number;
      plugins: number;
      apps: number;
    }
  | {
      protocol: "error";
      error: string;
    };

export async function inspectCodexAppServer(
  runtime: CodexAppServerRuntime,
  cwd: string
): Promise<CodexAppServerDoctorReport> {
  try {
    const models = await runtime.listModels();
    const skills = await runtime.listSkills(cwd);
    const plugins = await runtime.listInstalledPlugins(cwd);
    const apps = await runtime.listInstalledApps();
    return {
      protocol: "ok",
      models: models.length,
      skills: skills.length,
      plugins: plugins.length,
      apps: apps.length,
    };
  } catch (error) {
    return {
      protocol: "error",
      error: sanitizeServiceDiagnostic(formatError(error)),
    };
  } finally {
    await runtime.stop();
  }
}

export function renderCodexAppServerDoctorReport(
  report: CodexAppServerDoctorReport
): string[] {
  if (report.protocol === "error") {
    return [`App Server 协议：不可用（${report.error}）`];
  }
  return [
    "App Server 协议：可用",
    renderDirectoryCount("模型目录", report.models),
    renderDirectoryCount("Skill 目录", report.skills),
    renderDirectoryCount("插件目录", report.plugins),
    renderDirectoryCount("应用目录", report.apps),
  ];
}

function renderDirectoryCount(name: string, count: number): string {
  return count > 0 ? `${name}：${count} 项` : `${name}：可用，暂无项目`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
