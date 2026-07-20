# Feishu Return Files Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:test-driven-development to implement this plan. User instructions override worktree, subagent, and commit guidance: work in the current checkout, do not use subagents, and do not commit or push unless explicitly requested.

**Goal:** Return Codex-generated local files to the Feishu message that requested them.

**Architecture:** Add a focused return-file parser and validator beside the existing Feishu send layer. Pass a per-request output callback through the queued session router so cleaned text and validated files are always replied to the correct source message.

**Tech Stack:** TypeScript, Bun test, `@larksuiteoapi/node-sdk`, Codex CLI JSON output.

---

### Task 1: Return-file parsing and validation

**Files:**
- Create: `src/feishu/return-files.ts`
- Create: `tests/feishu-return-files.test.ts`

- [ ] Write failing tests for `[[codex:file:路径]]`, existing absolute paths and visible-text cleanup.
- [ ] Run `bun test tests/feishu-return-files.test.ts` and confirm the feature is missing.
- [ ] Implement extraction, deduplication and code-fence cleanup.
- [ ] Write failing tests for work-directory containment, existence, regular-file, non-empty and 30MB checks.
- [ ] Implement `resolveFeishuReturnFile` and rerun the focused tests.

### Task 2: Per-request output routing

**Files:**
- Modify: `src/session/router.ts`
- Modify: `tests/session-router.test.ts`

- [ ] Write a failing test that queues two messages with different output callbacks.
- [ ] Run the focused router test and verify the callback API is missing.
- [ ] Add an optional per-send output callback and prefer it over the router-wide fallback callback.
- [ ] Rerun `bun test tests/session-router.test.ts`.

### Task 3: Channel file replies and manual command

**Files:**
- Modify: `src/feishu/channel.ts`
- Modify: `tests/feishu-channel.test.ts`

- [ ] Write failing tests for automatic directive replies, absolute-path replies and `/file`.
- [ ] Verify the tests fail because channel output only sends text.
- [ ] Parse and validate output files, send cleaned text first, then call `sendFeishuFile`.
- [ ] Add `/file` and `/sendfile` command parsing with the same validation.
- [ ] Pass the source message ID through the router's per-request output callback.
- [ ] Rerun `bun test tests/feishu-channel.test.ts`.

### Task 4: Prompt contract and documentation

**Files:**
- Modify: `src/feishu/events.ts`
- Modify: `tests/feishu-events.test.ts`
- Modify: `README.md`
- Modify: `tests/readme.test.ts`

- [ ] Write a failing prompt test for the exact `[[codex:file:路径]]` instruction.
- [ ] Append the file-return instruction to Feishu-originated Codex prompts.
- [ ] Document automatic return files, `/file`, `/sendfile`, the 30MB limit and cwd restriction.
- [ ] Rerun the focused event and README tests.

### Task 5: Verification

**Files:**
- Test: `tests/*.test.ts`

- [ ] Run `bun test` and require zero failures.
- [ ] Run `bun run typecheck` and require exit code 0.
- [ ] Run `bun run build` and require exit code 0.
- [ ] Run `git diff --check` and inspect `git status --short`.
