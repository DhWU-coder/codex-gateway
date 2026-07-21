import { describe, expect, test } from "bun:test";
import {
  filterChannelStatusForDisplay,
  filterCodexStderrForDisplay,
} from "../src/web/stderr-display.js";

const iconWarning =
  "2026-07-21T06:50:48.363404Z WARN codex_core_skills::loader: ignoring interface.icon_small: icon path with '..' must resolve under plugin assets/";
const telemetryWarning =
  "2026-07-21T06:50:58.888244Z WARN codex_otel::events::session_telemetry: metrics counter [codex.skill.injected] failed: tag value contains invalid characters: superpowers:using-superpowers";

describe("Codex stderr Web 展示过滤", () => {
  test("移除两类已知无害告警并保留同一事件中的其他行", () => {
    expect(filterCodexStderrForDisplay(iconWarning)).toBe("");
    expect(filterCodexStderrForDisplay(telemetryWarning)).toBe("");
    expect(
      filterCodexStderrForDisplay(
        [iconWarning, "WARN codex_network: temporary retry", telemetryWarning].join("\n")
      )
    ).toBe("WARN codex_network: temporary retry");
  });

  test("不隐藏来源或错误原因不同的相似告警", () => {
    const differentWarning =
      "WARN codex_core_skills::loader: ignoring interface.icon_small: icon file is missing";

    expect(filterCodexStderrForDisplay(differentWarning)).toBe(differentWarning);
  });

  test("过滤嵌套的 stderr 展示事件且不修改原始频道状态", () => {
    const status = {
      channels: [
        {
          id: "feishu:primary",
          recentSessions: [
            {
              messages: [
                {
                  progressEvents: [
                    { type: "stderr", text: iconWarning, at: 1 },
                    {
                      type: "stderr",
                      text: `${telemetryWarning}\nWARN codex_network: temporary retry`,
                      at: 2,
                    },
                    { type: "tool_start", name: "command_execution", at: 3 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const filtered = filterChannelStatusForDisplay(status);
    const events = filtered.channels[0]?.recentSessions[0]?.messages[0]?.progressEvents;

    expect(events).toEqual([
      { type: "stderr", text: "WARN codex_network: temporary retry", at: 2 },
      { type: "tool_start", name: "command_execution", at: 3 },
    ]);
    expect(status.channels[0]?.recentSessions[0]?.messages[0]?.progressEvents).toHaveLength(3);
    expect(filtered).not.toBe(status);
  });
});
