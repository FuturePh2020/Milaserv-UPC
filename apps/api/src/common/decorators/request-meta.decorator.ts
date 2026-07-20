import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface RequestMeta {
  ipAddress: string;
  userAgent: string;
}

export const RequestMeta = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestMeta => {
  const request = ctx.switchToHttp().getRequest();
  const ipAddress = request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request.ip || "unknown";
  const userAgent = request.headers["user-agent"] || "unknown";
  return { ipAddress, userAgent };
});
