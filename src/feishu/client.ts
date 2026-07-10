import type { Readable } from "node:stream";
import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuAccountConfig } from "../config.js";
import type { FeishuEventClient, FeishuMediaClient } from "./channel.js";
import { type FeishuMessageClient, createSdkFeishuMessageClient } from "./send.js";

export interface FeishuSdkClients {
  eventClient: FeishuEventClient;
  mediaClient: FeishuMediaClient;
  messageClient: FeishuMessageClient;
}

interface FeishuWsClientLike {
  start(input: unknown): Promise<void> | void;
  close(input: unknown): void;
}

interface FeishuSdkMediaClientLike {
  im: {
    v1: {
      messageResource: {
        get(input: unknown): Promise<{
          headers?: Record<string, string>;
          getReadableStream(): Readable;
        }>;
      };
    };
  };
}

export function createFeishuSdkClients(account: FeishuAccountConfig): FeishuSdkClients {
  if (!account.appId || !account.appSecret) {
    throw new Error(`Feishu account ${account.id} is missing appId/appSecret`);
  }
  const sdkConfig = {
    appId: account.appId,
    appSecret: account.appSecret,
    domain: account.domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu,
  };
  const client = new Lark.Client(sdkConfig);
  const wsClient = new Lark.WSClient({
    ...sdkConfig,
    loggerLevel: Lark.LoggerLevel.info,
    source: "codex-gateway",
  });

  return {
    eventClient: createFeishuEventClient(wsClient),
    mediaClient: createFeishuMediaClient(client as FeishuSdkMediaClientLike),
    messageClient: createSdkFeishuMessageClient(client),
  };
}

export function createFeishuEventClient(wsClient: FeishuWsClientLike): FeishuEventClient {
  return {
    async start(onEvent) {
      const eventDispatcher = new Lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data: unknown) => onEvent({ event: data }),
      });
      await wsClient.start({ eventDispatcher });
    },
    async stop() {
      wsClient.close({ force: true });
    },
  };
}

export function createFeishuMediaClient(client: FeishuSdkMediaClientLike): FeishuMediaClient {
  return {
    async downloadImage(imageKey, messageId) {
      const response = await client.im.v1.messageResource.get({
        params: { type: "image" },
        path: { message_id: messageId, file_key: imageKey },
      });
      return {
        buffer: await readableToBuffer(response.getReadableStream()),
        contentType: response.headers?.["content-type"] ?? "image/png",
      };
    },
    async downloadFile(fileKey, messageId) {
      const response = await client.im.v1.messageResource.get({
        params: { type: "file" },
        path: { message_id: messageId, file_key: fileKey },
      });
      return {
        buffer: await readableToBuffer(response.getReadableStream()),
        contentType: response.headers?.["content-type"] ?? "application/octet-stream",
      };
    },
  };
}

async function readableToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
