import { readFileSync } from "node:fs";
import type { WebRequestContext } from "../web/access-control.js";
import {
  MAX_WEB_CHAT_FILE_BYTES,
} from "./files.js";
import {
  WebChatAuthService,
  type WebChatAuthenticatedSession,
} from "./auth.js";
import {
  normalizeWebChatCommand,
  WEB_CHAT_COMMANDS,
} from "./commands.js";
import { WebChatManager } from "./manager.js";
import {
  renderWebChatPage,
  type WebChatPageOptions,
} from "../web/chat/page.js";
import { buildWebChatBootstrap } from "./bootstrap.js";

const INLINE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export interface WebChatHttpOptions {
  manager: WebChatManager;
  auth: WebChatAuthService;
  renderPage?: (options: WebChatPageOptions) => string;
  registrationEnabled?: () => boolean;
}

export async function handleWebChatRequest(
  request: Request,
  options: WebChatHttpOptions,
  context: WebRequestContext
): Promise<Response> {
  const url = new URL(request.url);
  if ((url.pathname === "/chat" || url.pathname === "/chat/") && request.method === "GET") {
    const authenticated = options.auth.authenticate(
      request.headers.get("cookie")
    );
    const pageOptions: WebChatPageOptions = {
      registrationEnabled: options.registrationEnabled?.() ?? false,
      initiallyAuthenticated: Boolean(authenticated),
      bootstrapData: authenticated
        ? await buildWebChatBootstrap(options.manager, authenticated)
        : undefined,
    };
    return htmlResponse(options.renderPage?.(pageOptions) ?? renderWebChatPage(pageOptions));
  }

  if (url.pathname === "/api/chat/auth/login" && request.method === "POST") {
    const body = await readJson(request);
    const result = await options.auth.login(
      readString(body.username),
      readString(body.password),
      context.remoteAddress ?? "unknown"
    );
    if (!result.ok) {
      return jsonResponse(
        {
          error: result.message,
          ...(result.retryAfterSeconds
            ? { retryAfterSeconds: result.retryAfterSeconds }
            : {}),
        },
        result.status,
        result.retryAfterSeconds
          ? { "retry-after": String(result.retryAfterSeconds) }
          : undefined
      );
    }
    return jsonResponse(
      {
        user: result.user,
        csrfToken: result.csrfToken,
        expiresAt: result.expiresAt,
      },
      200,
      { "set-cookie": result.setCookie }
    );
  }

  if (url.pathname === "/api/chat/auth/register" && request.method === "POST") {
    if (!options.registrationEnabled?.()) {
      return jsonResponse({ error: "当前未开放注册。" }, 403);
    }
    const body = await readJson(request);
    const result = await options.auth.register(
      readString(body.username),
      readString(body.password),
      context.remoteAddress ?? "unknown"
    );
    if (!result.ok) {
      return jsonResponse(
        {
          error: result.message,
          ...(result.retryAfterSeconds
            ? { retryAfterSeconds: result.retryAfterSeconds }
            : {}),
        },
        result.status,
        result.retryAfterSeconds
          ? { "retry-after": String(result.retryAfterSeconds) }
          : undefined
      );
    }
    return jsonResponse(
      {
        user: result.user,
        csrfToken: result.csrfToken,
        expiresAt: result.expiresAt,
      },
      201,
      { "set-cookie": result.setCookie }
    );
  }

  const authenticated = options.auth.authenticate(request.headers.get("cookie"));
  if (!authenticated) return jsonResponse({ error: "请先登录。" }, 401);
  const mutation = isMutation(request.method);
  if (
    mutation &&
    !options.auth.authenticateMutation(
      request.headers.get("cookie"),
      request.headers.get("x-csrf-token")
    )
  ) {
    return jsonResponse({ error: "CSRF 校验失败。" }, 403);
  }

  try {
    if (url.pathname === "/api/chat/me" && request.method === "GET") {
      return jsonResponse({
        user: authenticated.user,
        csrfToken: authenticated.csrfToken,
        expiresAt: authenticated.expiresAt,
      });
    }
    if (url.pathname === "/api/chat/auth/logout" && request.method === "POST") {
      return jsonResponse(
        { ok: true },
        200,
        { "set-cookie": options.auth.logout(request.headers.get("cookie")) }
      );
    }
    if (url.pathname === "/api/chat/auth/password" && request.method === "POST") {
      const body = await readJson(request);
      const changed = await options.auth.changePassword(
        request.headers.get("cookie"),
        readString(body.currentPassword),
        readString(body.newPassword)
      );
      return changed
        ? jsonResponse(
            { ok: true },
            200,
            { "set-cookie": options.auth.logout(undefined) }
          )
        : jsonResponse({ error: "当前密码错误。" }, 400);
    }
    if (
      url.pathname === "/api/chat/account-settings"
      && request.method === "GET"
    ) {
      return jsonResponse({
        settings: await options.manager.getAccountSettings(
          authenticated.user.id
        ),
      });
    }
    if (
      url.pathname === "/api/chat/account-settings"
      && request.method === "PUT"
    ) {
      const body = await readJson(request);
      const settings = await options.manager.updateAccountSettings(
        authenticated.user.id,
        {
          ...(Object.prototype.hasOwnProperty.call(body, "model")
            ? { model: nullableString(body.model) }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(body, "reasoningEffort")
            ? { reasoningEffort: nullableString(body.reasoningEffort) as never }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(body, "fast")
            ? { fast: nullableBoolean(body.fast) }
            : {}),
        }
      );
      return jsonResponse({ settings });
    }
    if (url.pathname === "/api/chat/models" && request.method === "GET") {
      return jsonResponse({ models: await options.manager.listModels() });
    }
    if (url.pathname === "/api/chat/capabilities" && request.method === "GET") {
      const sessionId = readString(url.searchParams.get("sessionId"));
      return jsonResponse({
        capabilities: await options.manager.listCapabilities(
          authenticated.user.id,
          sessionId
        ),
        commands: WEB_CHAT_COMMANDS,
      });
    }
    if (url.pathname === "/api/chat/files/search" && request.method === "GET") {
      const sessionId = readString(url.searchParams.get("sessionId"));
      const query = readString(url.searchParams.get("q"));
      return jsonResponse({
        capabilities: await options.manager.searchCapabilities(
          authenticated.user.id,
          sessionId,
          query
        ),
      });
    }
    if (url.pathname === "/api/chat/events" && request.method === "GET") {
      return createEventStream(request, options.manager, authenticated);
    }
    if (url.pathname === "/api/chat/sessions" && request.method === "GET") {
      return jsonResponse({
        sessions: options.manager.listSessions(authenticated.user.id),
      });
    }
    if (url.pathname === "/api/chat/sessions" && request.method === "POST") {
      const body = await readJson(request);
      const session = options.manager.createSession(authenticated.user.id, {
        title: optionalString(body.title),
        model: optionalString(body.model),
      });
      return jsonResponse({ session }, 201);
    }
    if (url.pathname === "/api/chat/sessions" && request.method === "DELETE") {
      const body = await readJson(request);
      const sessionIds = Array.isArray(body.sessionIds)
        ? body.sessionIds.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0
          )
        : [];
      if (sessionIds.length === 0) {
        return jsonResponse({ error: "至少选择一个 Session。" }, 400);
      }
      return jsonResponse(
        options.manager.removeSessions(authenticated.user.id, sessionIds)
      );
    }

    const fileDownload = matchPath(url.pathname, /^\/api\/chat\/files\/([^/]+)$/);
    if (fileDownload && request.method === "GET") {
      const opened = options.manager.openFile(
        authenticated.user.id,
        fileDownload[0]
      );
      if (!opened) return jsonResponse({ error: "文件不存在。" }, 404);
      const inline =
        url.searchParams.get("preview") === "1" &&
        INLINE_IMAGE_MIME_TYPES.has(opened.file.mimeType.toLowerCase());
      return new Response(readFileSync(opened.path), {
        headers: {
          "content-type": opened.file.mimeType,
          "content-length": String(opened.file.size),
          "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(opened.file.name)}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

    const messagesRoute = matchPath(
      url.pathname,
      /^\/api\/chat\/sessions\/([^/]+)\/messages$/
    );
    if (messagesRoute && request.method === "GET") {
      const page = options.manager.listMessages(
        authenticated.user.id,
        messagesRoute[0],
        {
          offset: readInteger(url.searchParams.get("offset")),
          limit: readInteger(url.searchParams.get("limit")),
        }
      );
      return page
        ? jsonResponse(page)
        : jsonResponse({ error: "Session 不存在。" }, 404);
    }
    if (messagesRoute && request.method === "POST") {
      const sessionId = messagesRoute[0];
      if (!options.manager.getSession(authenticated.user.id, sessionId)) {
        return jsonResponse({ error: "Session 不存在。" }, 404);
      }
      const body = await readJson(request);
      const text = readString(body.text);
      const fileIds = Array.isArray(body.fileIds)
        ? body.fileIds.filter((value): value is string => typeof value === "string")
        : [];
      const references = Array.isArray(body.references)
        ? body.references.filter(
            (value): value is string => typeof value === "string"
          )
        : [];
      if (!text.trim() && fileIds.length === 0 && references.length === 0) {
        return jsonResponse({ error: "消息内容不能为空。" }, 400);
      }
      void options.manager
        .sendMessage(authenticated.user.id, sessionId, {
          text,
          fileIds,
          references,
        })
        .catch(() => undefined);
      return jsonResponse({ accepted: true }, 202);
    }

    const commandRoute = matchPath(
      url.pathname,
      /^\/api\/chat\/sessions\/([^/]+)\/commands$/
    );
    if (commandRoute && request.method === "POST") {
      const body = await readJson(request);
      const command = normalizeWebChatCommand(
        readString(body.name),
        body.arguments
      );
      const result = await options.manager.executeCommand(
        authenticated.user.id,
        commandRoute[0],
        command
      );
      return jsonResponse({ result });
    }

    const runtimeRoute = matchPath(
      url.pathname,
      /^\/api\/chat\/sessions\/([^/]+)\/runtime$/
    );
    if (runtimeRoute && request.method === "PUT") {
      const body = await readJson(request);
      const session = await options.manager.updateRuntime(
        authenticated.user.id,
        runtimeRoute[0],
        {
          ...(Object.prototype.hasOwnProperty.call(body, "model")
            ? { model: nullableString(body.model) }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(body, "reasoningEffort")
            ? { reasoningEffort: nullableString(body.reasoningEffort) as never }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(body, "fast")
            ? { fast: nullableBoolean(body.fast) }
            : {}),
        }
      );
      return session
        ? jsonResponse({ session })
        : jsonResponse({ error: "Session 不存在或正在运行。" }, 409);
    }

    const stopRoute = matchPath(
      url.pathname,
      /^\/api\/chat\/sessions\/([^/]+)\/stop$/
    );
    if (stopRoute && request.method === "POST") {
      return options.manager.stopSession(authenticated.user.id, stopRoute[0])
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "Session 不存在或未在运行。" }, 404);
    }

    const forkRoute = matchPath(
      url.pathname,
      /^\/api\/chat\/sessions\/([^/]+)\/fork$/
    );
    if (forkRoute && request.method === "POST") {
      const session = options.manager.forkSession(
        authenticated.user.id,
        forkRoute[0]
      );
      return session
        ? jsonResponse({ session }, 201)
        : jsonResponse({ error: "Session 不存在或正在运行。" }, 409);
    }

    const uploadRoute = matchPath(
      url.pathname,
      /^\/api\/chat\/sessions\/([^/]+)\/files$/
    );
    if (uploadRoute && request.method === "POST") {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return jsonResponse({ error: "缺少上传文件。" }, 400);
      }
      if (file.size <= 0) return jsonResponse({ error: "不能上传空文件。" }, 400);
      if (file.size > MAX_WEB_CHAT_FILE_BYTES) {
        return jsonResponse({ error: "上传文件超过 30MB。" }, 413);
      }
      const saved = options.manager.uploadFile(
        authenticated.user.id,
        uploadRoute[0],
        {
          name: file.name,
          mimeType: file.type,
          data: new Uint8Array(await file.arrayBuffer()),
        }
      );
      return jsonResponse({ file: saved }, 201);
    }

    const sessionRoute = matchPath(
      url.pathname,
      /^\/api\/chat\/sessions\/([^/]+)$/
    );
    if (sessionRoute && request.method === "GET") {
      const session = options.manager.getSession(
        authenticated.user.id,
        sessionRoute[0]
      );
      return session
        ? jsonResponse({
            session,
            messages: options.manager.listMessages(
              authenticated.user.id,
              session.id
            ),
            traces: options.manager.listTraces(
              authenticated.user.id,
              session.id
            ),
          })
        : jsonResponse({ error: "Session 不存在。" }, 404);
    }
    if (sessionRoute && request.method === "PATCH") {
      const body = await readJson(request);
      const session = options.manager.renameSession(
        authenticated.user.id,
        sessionRoute[0],
        readString(body.title)
      );
      return session
        ? jsonResponse({ session })
        : jsonResponse({ error: "Session 不存在。" }, 404);
    }
    if (sessionRoute && request.method === "DELETE") {
      return options.manager.removeSession(authenticated.user.id, sessionRoute[0])
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "Session 不存在。" }, 404);
    }
  } catch (error) {
    return jsonResponse({ error: formatError(error) }, 400);
  }

  return jsonResponse({ error: "Chat 路由不存在。" }, 404);
}

export async function handleWebChatAdminRequest(
  request: Request,
  manager: WebChatManager,
  auth: WebChatAuthService
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/web-chat/users" && request.method === "GET") {
    return jsonResponse({ users: manager.listUsers() });
  }
  if (url.pathname === "/api/web-chat/users" && request.method === "POST") {
    try {
      const body = await readJson(request);
      const user = await manager.createUser({
        username: readString(body.username),
        password: readString(body.password),
        model: optionalString(body.model),
        reasoningEffort: optionalString(body.reasoningEffort) as never,
        fast: optionalBoolean(body.fast),
        verbosity: optionalString(body.verbosity) as never,
      });
      return jsonResponse({ user }, 201);
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 400);
    }
  }

  const passwordRoute = matchPath(
    url.pathname,
    /^\/api\/web-chat\/users\/([^/]+)\/password$/
  );
  if (passwordRoute && request.method === "POST") {
    try {
      const body = await readJson(request);
      const changed = await manager.resetUserPassword(
        passwordRoute[0],
        readString(body.password)
      );
      if (!changed) return jsonResponse({ error: "用户不存在。" }, 404);
      auth.revokeUser(passwordRoute[0]);
      return jsonResponse({ ok: true });
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 400);
    }
  }

  const userRoute = matchPath(
    url.pathname,
    /^\/api\/web-chat\/users\/([^/]+)$/
  );
  if (userRoute && request.method === "PATCH") {
    try {
      const body = await readJson(request);
      const user = manager.updateUser(userRoute[0], {
        ...(Object.prototype.hasOwnProperty.call(body, "username")
          ? { username: readString(body.username) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "enabled")
          ? { enabled: Boolean(body.enabled) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "model")
          ? { model: nullableString(body.model) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "reasoningEffort")
          ? { reasoningEffort: nullableString(body.reasoningEffort) as never }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "fast")
          ? { fast: nullableBoolean(body.fast) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "verbosity")
          ? { verbosity: nullableString(body.verbosity) as never }
          : {}),
      });
      if (!user) return jsonResponse({ error: "用户不存在。" }, 404);
      if (!user.enabled) auth.revokeUser(user.id);
      return jsonResponse({ user });
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 400);
    }
  }
  if (userRoute && request.method === "DELETE") {
    const body = await readJson(request);
    const purge = body.purge === true;
    const user = manager.listUsers().find((item) => item.id === userRoute[0]);
    if (!user) return jsonResponse({ error: "用户不存在。" }, 404);
    if (purge && readString(body.confirmUsername) !== user.username) {
      return jsonResponse({ error: "彻底删除必须确认用户名。" }, 400);
    }
    auth.revokeUser(user.id);
    manager.removeUser(user.id, purge);
    return jsonResponse({ ok: true });
  }

  return null;
}

function createEventStream(
  request: Request,
  manager: WebChatManager,
  authenticated: WebChatAuthenticatedSession
): Response {
  const encoder = new TextEncoder();
  const lastEventId = readInteger(request.headers.get("last-event-id"));
  let unsubscribe: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let abort = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const replay = manager.eventHub.eventsSince(
        authenticated.user.id,
        lastEventId
      );
      if (replay.reset) {
        controller.enqueue(
          encoder.encode('event: snapshot.required\ndata: {"reset":true}\n\n')
        );
      } else {
        for (const event of replay.events) {
          controller.enqueue(encoder.encode(formatSseEvent(event)));
        }
      }
      unsubscribe = manager.eventHub.subscribe(authenticated.user.id, (event) => {
        controller.enqueue(encoder.encode(formatSseEvent(event)));
      });
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {}
      }, 20_000);
      abort = () => {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", abort, { once: true });
    },
    cancel() {
      request.signal.removeEventListener("abort", abort);
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function formatSseEvent(event: {
  id: number;
  type: string;
  sessionId: string;
  createdAt: string;
  payload: Record<string, unknown>;
}): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({
    sessionId: event.sessionId,
    createdAt: event.createdAt,
    ...event.payload,
  })}\n\n`;
}

function matchPath(pathname: string, pattern: RegExp): string[] | null {
  const match = pathname.match(pattern);
  if (!match) return null;
  try {
    return match.slice(1).map((value) => decodeURIComponent(value));
  } catch {
    return null;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) return {};
  const value = (await request.json()) as unknown;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : optionalString(value) ?? null;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function nullableBoolean(value: unknown): boolean | null {
  return value === null ? null : optionalBoolean(value) ?? null;
}

function readInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}

function isMutation(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers?: Record<string, string>
): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
