import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { RolesGuard } from "../common/guards/roles.guard";
import { CustomersService } from "./customers.service";

@ApiTags("customers")
@ApiBearerAuth()
@Controller("customers")
@UseGuards(RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get("search")
  search(@Query("q") q: string) {
    return this.customersService.search(q ?? "");
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.customersService.findOne(id);
  }
}
