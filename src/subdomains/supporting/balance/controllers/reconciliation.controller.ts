import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { ReconciliationDto, ReconciliationQuery } from '../dto/reconciliation.dto';
import { ReconciliationService } from '../services/reconciliation.service';

@Controller('balance')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get('reconciliation')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.DEBUG), UserActiveGuard())
  async getReconciliation(@Query() query: ReconciliationQuery): Promise<ReconciliationDto> {
    return this.reconciliationService.getReconciliation(query);
  }
}
