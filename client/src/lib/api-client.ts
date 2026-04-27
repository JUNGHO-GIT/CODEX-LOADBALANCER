import type { ZodType } from "zod";
import { ApiErrorResponseSchema } from "@/schemas/api";

type HttpMethod = "GET" | "POST";

type RequestOptions = {
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

// 1. Payload parse ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function parsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  }
  catch {
    return text;
  }
}

// 2. Error message read ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function readErrorMessage(payload: unknown, fallback: string): string {
  const parsed = ApiErrorResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return fallback;
  }
  if (typeof parsed.data.error === "string") {
    return parsed.data.error;
  }
  return parsed.data.error.message || fallback;
}

// 3. Request ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function request<T>(method: HttpMethod, url: string, schema: ZodType<T>, options?: RequestOptions): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(options?.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options?.signal,
  });
  const payload = await parsePayload(response);
  if (!response.ok) {
    throw new ApiError(readErrorMessage(payload, `Request failed with ${response.status}`), response.status, payload);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError("Response schema mismatch", response.status, parsed.error.format());
  }
  return parsed.data;
}

// 4. Get ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function get<T>(url: string, schema: ZodType<T>, options?: RequestOptions): Promise<T> {
  return request("GET", url, schema, options);
}

// 5. Post ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function post<T>(url: string, schema: ZodType<T>, options?: RequestOptions): Promise<T> {
  return request("POST", url, schema, options);
}
