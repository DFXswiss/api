import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DashboardFinancialService } from './dashboard-financial.service';
import { FinancialLogResponseDto } from './dto/financial-log.dto';

@ApiTags('dashboard')
@Controller('dashboard/financial')
export class DashboardFinancialController {
  constructor(private readonly dashboardFinancialService: DashboardFinancialService) {}

  @Get('log')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getFinancialLog(
    @Query('from') from?: string,
    @Query('dailySample') dailySample?: string,
  ): Promise<FinancialLogResponseDto> {
    const fromDate = from ? new Date(from) : undefined;
    const sample = dailySample !== 'false';

    return this.dashboardFinancialService.getFinancialLog(fromDate, sample);
  }
}
