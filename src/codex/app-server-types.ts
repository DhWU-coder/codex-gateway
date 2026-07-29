export type AppServerRequestId = number;

export interface AppServerRequest {
  id: AppServerRequestId;
  method: string;
  params?: unknown;
}

export interface AppServerNotification {
  method: string;
  params?: unknown;
}

export interface AppServerResponse {
  id: AppServerRequestId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export interface AppServerInitializeResponse {
  userAgent?: string;
  codexHome?: string;
  platformFamily?: string;
  platformOs?: string;
}

export type AppServerServerRequestHandler = (
  request: AppServerRequest
) => Promise<unknown> | unknown;
