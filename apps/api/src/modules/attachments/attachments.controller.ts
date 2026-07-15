import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { IsString, MinLength } from 'class-validator';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionsService } from '../permissions/permissions.service';
import { AttachmentsService } from './attachments.service';

class UploadQueryDto {
  @IsString()
  @MinLength(1)
  entityType: string;

  @IsString()
  @MinLength(1)
  entityId: string;
}

interface UploadedFileShape {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

@Controller('attachments')
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: AuthUser,
    @Query() q: UploadQueryDto,
    @UploadedFile() file: UploadedFileShape | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    return this.attachments.upload(
      user,
      {
        entityType: q.entityType,
        entityId: q.entityId,
        fileName: file.originalname,
        mimeType: file.mimetype,
        data: file.buffer,
      },
      { ip: req.ip },
    );
  }

  @Get()
  list(@Query() q: UploadQueryDto) {
    return this.attachments.listFor(q.entityType, q.entityId);
  }

  @Get(':id/download')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const effective = await this.permissions.getEffectivePermissions(user.userId);
    const { attachment, data } = await this.attachments.download(user, effective.permissions, id, {
      ip: req.ip,
    });
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
    );
    res.send(data);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const effective = await this.permissions.getEffectivePermissions(user.userId);
    await this.attachments.remove(user, effective.permissions, id, { ip: req.ip });
  }
}
