import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Global: every domain module records audit entries (Audit Everything, §4). */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
