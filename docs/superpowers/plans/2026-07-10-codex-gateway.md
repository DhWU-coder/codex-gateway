# Codex Gateway Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:test-driven-development for implementation. User instructions override commits and worktrees: do not create a worktree and do not run git add/commit.

**Goal:** Build an independent Feishu WebSocket gateway that routes Feishu agent messages into Codex CLI sessions.

**Architecture:** Keep Feishu protocol handling separate from Codex process execution. Persist one current Codex session per Feishu direct chat or group chat, with JSONL fallback history when native session id is unavailable.

**Tech Stack:** TypeScript, Bun, `@larksuiteoapi/node-sdk`, `yaml`, Codex CLI.

---

### Task 1: Project Skeleton And Core Tests

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tests/*.test.ts`

- [x] Add package scripts and strict TypeScript config.
- [x] Add failing tests for config parsing, Feishu event parsing, Codex command construction, and session routing.

### Task 2: Configuration And Paths

**Files:**
- Create: `src/paths.ts`
- Create: `src/config.ts`

- [x] Implement `~/.codex-gateway/config.yaml` loading.
- [x] Support multi-account Feishu config with sane defaults.
- [x] Expand `~` paths and env fallbacks.

### Task 3: Feishu Protocol Layer

**Files:**
- Create: `src/feishu/events.ts`
- Create: `src/feishu/files.ts`
- Create: `src/feishu/send.ts`
- Create: `src/feishu/client.ts`
- Create: `src/feishu/channel.ts`

- [x] Parse Feishu text/post/image/file messages.
- [x] Handle private chats directly and group chats only when @bot is present.
- [x] Download message resources to local workspace.
- [x] Split long replies and send text/file replies through Feishu SDK.

### Task 4: Codex Runner And Sessions

**Files:**
- Create: `src/codex/json-events.ts`
- Create: `src/codex/runner.ts`
- Create: `src/session/history.ts`
- Create: `src/session/router.ts`

- [x] Build `codex exec --json` and `codex exec resume` commands.
- [x] Extract final assistant reply from `--output-last-message`.
- [x] Extract session id from JSONL events when Codex exposes it.
- [x] Persist per-conversation current session metadata and messages.
- [x] Queue messages per conversation.

### Task 5: CLI Entrypoint

**Files:**
- Create: `src/index.ts`
- Create: `bin/codex-gateway.cjs`
- Create: `README.md`
- Create: `config-example.yaml`

- [x] Add `start`, `init-config`, and `doctor` commands.
- [x] Keep `start` foreground and signal-safe.
- [x] Document Feishu config and local usage.

### Task 6: Background Service And Web UI

**Files:**
- Create: `src/service/*.ts`
- Create: `src/web-server.ts`
- Modify: `src/index.ts`
- Modify: `src/cli.ts`
- Modify: `README.md`

- [x] Make `run` and `start` both start a detached background service.
- [x] Add `restart`, `stop`, and `status` lifecycle commands.
- [x] Persist service pid, Web UI URL, cwd, log path, and channel state.
- [x] Add localhost Web UI monitor and `/api/status` / `/api/channels` endpoints.
- [x] Keep the daemon entrypoint internal via `--service-daemon`.

### Verification

- [x] `bun install`
- [x] `bun test`
- [x] `bun run typecheck`
- [x] `bun run build`
