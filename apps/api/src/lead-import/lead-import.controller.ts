import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags, ApiBearerAuth, ApiConsumes } from "@nestjs/swagger";
import { Response } from "express";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { LeadImportService } from "./lead-import.service";

const ALLOWED_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
];
const MAX_SIZE_BYTES = Number(process.env.MAX_UPLOAD_SIZE_MB || 20) * 1024 * 1024;

function fileFilter(_req: any, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) {
  const okExt = /\.(xlsx|xls|csv)$/i.test(file.originalname);
  if (!okExt) {
    return cb(new BadRequestException("Only .xlsx, .xls, or .csv files are allowed"), false);
  }
  cb(null, true);
}

@ApiTags("lead-imports")
@ApiBearerAuth()
@Controller("lead-imports")
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class LeadImportController {
  constructor(private readonly service: LeadImportService) {}

  @Post("preview")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_SIZE_BYTES }, fileFilter }))
  preview(@UploadedFile() file: Express.Multer.File, @Body("partnerId") partnerId: string) {
    if (!file) throw new BadRequestException("File is required");
    return this.service.preview(file.buffer, file.originalname, partnerId);
  }

  @Post("batches")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_SIZE_BYTES }, fileFilter }))
  async createBatch(
    @UploadedFile() file: Express.Multer.File,
    @Body("partnerId") partnerId: string,
    @Body("categoryId") categoryId: string,
    @Body("taskId") taskId: string | undefined,
    @Body("mapping") mappingRaw: string,
    @Body("duplicateHandling") duplicateHandling: any,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("File is required");
    const mapping = JSON.parse(mappingRaw);
    return this.service.createBatch({
      buffer: file.buffer,
      fileName: file.originalname,
      fileSize: file.size,
      partnerId,
      categoryId,
      taskId: taskId || undefined,
      mapping,
      duplicateHandling,
      uploadedById: actor.userId,
    });
  }

  @Get("batches")
  list(@Query("partnerId") partnerId?: string, @Query("status") status?: string) {
    return this.service.listBatches({ partnerId, status });
  }

  @Get("batches/:id")
  getOne(@Param("id") id: string) {
    return this.service.getBatch(id);
  }

  @Post("batches/:id/commit")
  commit(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.commit(id, actor.userId);
  }

  @Post("batches/:id/cancel")
  cancel(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.cancel(id, actor.userId);
  }

  @Get("batches/:id/rejected-rows/export")
  async downloadRejected(@Param("id") id: string, @Res() res: Response) {
    const buffer = await this.service.downloadRejectedRows(id);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="rejected-rows-${id}.xlsx"`);
    res.send(buffer);
  }
}
