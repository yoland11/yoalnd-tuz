import type { NextRequest } from "next/server";
import { handleApi } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ path?: string[] }>;
};

async function dispatch(req: NextRequest, context: Context) {
  const { path = [] } = await context.params;
  return handleApi(req, path);
}

export function GET(req: NextRequest, context: Context) {
  return dispatch(req, context);
}

export function POST(req: NextRequest, context: Context) {
  return dispatch(req, context);
}

export function PUT(req: NextRequest, context: Context) {
  return dispatch(req, context);
}

export function PATCH(req: NextRequest, context: Context) {
  return dispatch(req, context);
}

export function DELETE(req: NextRequest, context: Context) {
  return dispatch(req, context);
}
