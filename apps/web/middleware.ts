import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = ["/admin", "/agent"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasAccessToken = req.cookies.has("access_token");

  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) && !hasAccessToken) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login" && hasAccessToken) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/agent/:path*", "/login"],
};
