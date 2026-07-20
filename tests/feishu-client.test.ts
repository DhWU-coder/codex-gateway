import { describe, expect, test } from "bun:test";
import { createSdkFeishuReactionClient } from "../src/feishu/client.js";

describe("Feishu SDK client", () => {
  test("adds and removes the Typing reaction", async () => {
    const calls: unknown[] = [];
    const reactionClient = createSdkFeishuReactionClient({
      im: {
        v1: {
          messageReaction: {
            async create(input) {
              calls.push(["create", input]);
              return { data: { reaction_id: "reaction-1" } };
            },
            async delete(input) {
              calls.push(["delete", input]);
            },
          },
        },
      },
    });

    const state = await reactionClient.addTypingReaction({ messageId: "om_1" });
    await reactionClient.removeTypingReaction({
      messageId: "om_1",
      reactionId: state.reactionId ?? "",
    });

    expect(calls).toEqual([
      [
        "create",
        {
          path: { message_id: "om_1" },
          data: { reaction_type: { emoji_type: "Typing" } },
        },
      ],
      [
        "delete",
        {
          path: { message_id: "om_1", reaction_id: "reaction-1" },
        },
      ],
    ]);
  });
});
