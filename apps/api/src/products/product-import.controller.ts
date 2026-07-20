import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags, ApiBearerAuth, ApiConsumes } from "@nestjs/swagger";
import { Response } from "express";
import { Permission } from "@lcrm/shared";
import { RolesGuard } from "../common/guards/roles.guard";
import { PermissionsGuard } from "../permissions/permissions.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { ProductImportService } from "./product-import.service";

const MAX_SIZE_BYTES = Number(process.env.MAX_UPLOAD_SIZE_MB || 20) * 1024 * 1024;

function fileFilter(_req: any, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) {
  const okExt = /\.(xlsx|xls|csv)$/i.test(file.originalname);
  if (!okExt) return cb(new BadRequestException("Only .xlsx, .xls, or .csv files are allowed"), false);
  cb(null, true);
}

@ApiTags("products-import")
@ApiBearerAuth()
@Controller("products/import")
@UseGuards(RolesGuard, PermissionsGuard)
@RequirePermission(Permission.PRODUCTS_IMPORT)
export class ProductImportController {
  constructor(private readonly importService: ProductImportService) {}

  @Post("preview")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_SIZE_BYTES }, fileFilter }))
  preview(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("File is required");
    return this.importService.preview(file.buffer, file.originalname);
  }

  @Post("commit")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_SIZE_BYTES }, fileFilter }))
  async commit(
    @UploadedFile() file: Express.Multer.File,
    @Body("mapping") mappingRaw: string,
    @Body("behavior") behavior: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("File is required");
    return this.importService.commit({
      buffer: file.buffer,
      fileName: file.originalname,
      fileSize: file.size,
      mapping: JSON.parse(mappingRaw),
      behavior,
      uploadedById: actor.userId,
    });
  }

  @Get("batches")
  listBatches() {
    return this.importService.listBatches();
  }

  @Get("batches/:id/rejected-rows/export")
  async downloadRejected(@Param("id") id: string, @Res() res: Response) {
    const buffer = await this.importService.downloadRejectedRows(id);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="rejected-products-${id}.xlsx"`);
    res.send(buffer);
  }
}
