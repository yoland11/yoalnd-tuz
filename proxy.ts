import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "ajn_admin_session";
const CUSTOMER_COOKIE_NAME = "ajn_customer_session";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/admin") &&
    pathname !== "/admin/login" &&
    !pathname.startsWith("/admin/invoice") &&
    !req.cookies.get(COOKIE_NAME)?.value
  ) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if ((pathname === "/profile" || pathname === "/account") && !req.cookies.get(CUSTOMER_COOKIE_NAME)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/profile", "/account"],
};
