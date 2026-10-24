import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Legacy demo URLs used `/?tab=…`; the app lives at `/app`. */
const APP_QUERY_KEYS = new Set(["tab", "case", "filter", "fund", "key"]);

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname !== "/") return NextResponse.next();

  const hasAppQuery = [...searchParams.keys()].some((k) => APP_QUERY_KEYS.has(k));
  if (!hasAppQuery) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/app";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/"],
};
