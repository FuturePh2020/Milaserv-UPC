import { Module } from '@nestjs/common';
import { NumberingModule } from '../numbering/numbering.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { TelesalesKpiService } from './telesales-kpi.service';

/** CRM, Leads & Telesales (blueprint §14). */
@Module({
  imports: [NumberingModule],
  controllers: [CrmController],
  providers: [CrmService, TelesalesKpiService],
  exports: [CrmService, TelesalesKpiService],
})
export class CrmModule {}
