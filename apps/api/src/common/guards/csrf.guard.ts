import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Double-submit-cookie CSRF protection. The `csrf_token` cookie is
 * non-httpOnly (readable by our own frontend JS) so it can be echoed back
 * in the `x-csrf-token` header; a cross-site request forged against the
 * cookie-authenticated session cannot read the cookie to set that header.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (SAFE_METHODS.has(request.method)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Public endpoints that don't rely on the auth cookie (login) don't need it;
    // but if a csrf cookie is already present (e.g. logout), still enforce it.
    const csrfCookie = request.cookies?.csrf_token;
    if (isPublic && !csrfCookie) return true;

    // Webhook + refresh endpoints authenticate via signature/refresh-token, not the CSRF cookie.
    if (request.path?.startsWith("/api/voip/webhook")) return true;

    const headerToken = request.headers["x-csrf-token"];
    if (!csrfCookie || !headerToken || headerToken !== csrfCookie) {
      throw new ForbiddenException("Invalid or missing CSRF token");
    }
    return true;
  }
}
