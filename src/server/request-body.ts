import type { NextRequest } from "next/server";

export class InvalidJsonBodyError extends Error {
  constructor() {
    super("Malformed JSON request body");
    this.name = "InvalidJsonBodyError";
  }
}

const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

export class RequestBodyTooLargeError extends Error {}

/**
 * Reads AJN JSON/form request bodies without converting malformed JSON into an
 * empty object. An actually empty body remains supported for endpoints whose
 * contract allows it.
 */
export async function readRequestBody(req: NextRequest): Promise<any> {
  if (req.method === "GET" || req.method === "HEAD") return {};
  const declaredSize = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REQUEST_BODY_BYTES)
    throw new RequestBodyTooLargeError("request body exceeds limit");
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BODY_BYTES)
    throw new RequestBodyTooLargeError("request body exceeds limit");
  if (!raw.trim()) return {};
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(raw).entries());
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidJsonBodyError();
  }
}
