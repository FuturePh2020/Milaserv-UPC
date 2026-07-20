import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { RequestMeta, RequestMeta as RequestMetaType } from "../common/decorators/request-meta.decorator";
import { PrismaService } from "../prisma/prisma.service";

function cookieOptions(config: ConfigService, maxAgeMs: number, httpOnly = true) {
  const isProd = config.get("NODE_ENV") === "production";
  return {
    httpOnly,
    secure: isProd,
    sameSite: "lax" as const,
    domain: config.get<string>("COOKIE_DOMAIN") || undefined,
    maxAge: maxAgeMs,
    path: "/",
  };
}

function setAuthCookies(res: Response, config: ConfigService, result: { accessToken: string; accessTokenTtlSec: number; refreshToken: string; refreshTokenTtlSec: number }) {
  res.cookie("access_token", result.accessToken, cookieOptions(config, result.accessTokenTtlSec * 1000));
  res.cookie("refresh_token", result.refreshToken, cookieOptions(config, result.refreshTokenTtlSec * 1000));
  res.cookie("csrf_token", randomBytes(24).toString("hex"), cookieOptions(config, result.accessTokenTtlSec * 1000, false));
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @RequestMeta() meta: RequestMetaType,
  ) {
    const result = await this.authService.login(dto.username, dto.password, meta);
    setAuthCookies(res, this.config, result);
    return { user: result.user };
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @RequestMeta() meta: RequestMetaType,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      throw new UnauthorizedException("Missing refresh token");
    }
    const result = await this.authService.refresh(refreshToken, meta);
    setAuthCookies(res, this.config, result);
    return { user: result.user };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @RequestMeta() meta: RequestMetaType,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    const userId = (req as any).user?.userId;
    await this.authService.logout(refreshToken, userId, meta);
    res.clearCookie("access_token", { path: "/" });
    res.clearCookie("refresh_token", { path: "/" });
    res.clearCookie("csrf_token", { path: "/" });
    return { success: true };
  }

  @Get("me")
  async me(@CurrentUser() user: AuthenticatedUser) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        email: true,
        currentAgentStatus: true,
        team: { select: { id: true, name: true } },
      },
    });
    return dbUser;
  }
}
