import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("teams")
@ApiBearerAuth()
@Controller("teams")
@UseGuards(RolesGuard)
export class TeamsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.team.findMany({ orderBy: { name: "asc" } });
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body("name") name: string) {
    return this.prisma.team.create({ data: { name } });
  }
}
