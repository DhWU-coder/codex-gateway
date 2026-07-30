import { describe, expect, test } from "bun:test";
import {
  createFeishuEventClient,
  createSdkFeishuReactionClient,
} from "../src/feishu/client.js";

describe("Feishu SDK client", () => {
  test("立即完成 SDK 事件回调并在后台处理消息", async () => {
    let eventHandler: ((data: unknown) => Promise<void>) | undefined;
    let finishBusiness: (() => void) | undefined;
    let businessFinished = false;
    const eventClient = createFeishuEventClient({
      async start(input) {
        const dispatcher = (
          input as {
            eventDispatcher: {
              handles: Map<string, (data: unknown) => Promise<void>>;
            };
          }
        ).eventDispatcher;
        eventHandler = dispatcher.handles.get("im.message.receive_v1");
      },
      close() {},
    });

    await eventClient.start(
      () =>
        new Promise<void>((resolve) => {
          finishBusiness = () => {
            businessFinished = true;
            resolve();
          };
        })
    );

    expect(eventHandler).toBeDefined();
    await eventHandler?.({ message: { message_id: "om_1" } });

    expect(businessFinished).toBe(false);
    finishBusiness?.();
  });

  test("记录后台事件处理异常而不让 SDK 回调失败", async () => {
    let eventHandler: ((data: unknown) => Promise<void>) | undefined;
    const errors: string[] = [];
    const eventClient = createFeishuEventClient(
      {
        async start(input) {
          const dispatcher = (
            input as {
              eventDispatcher: {
                handles: Map<string, (data: unknown) => Promise<void>>;
              };
            }
          ).eventDispatcher;
          eventHandler = dispatcher.handles.get("im.message.receive_v1");
        },
        close() {},
      },
      {
        error(message) {
          errors.push(String(message));
        },
      }
    );

    await eventClient.start(async () => {
      throw new Error("后台处理失败");
    });

    await eventHandler?.({ message: { message_id: "om_2" } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors).toEqual(["飞书事件后台处理失败：后台处理失败"]);
  });

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
