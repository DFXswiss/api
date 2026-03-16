import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DashboardFinancialService } from './dashboard-financial.service';
import {
  FinancialChangesEntryDto,
  FinancialChangesResponseDto,
  FinancialLogResponseDto,
  LatestBalanceResponseDto,
  RefRewardRecipientDto,
} from './dto/financial-log.dto';

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

  @Get('latest')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getLatestBalance(): Promise<LatestBalanceResponseDto> {
    return this.dashboardFinancialService.getLatestBalance();
  }

  @Get('changes/latest')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getLatestChanges(): Promise<FinancialChangesEntryDto> {
    return this.dashboardFinancialService.getLatestFinancialChanges();
  }

  @Get('ref-recipients')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getRefRewardRecipients(@Query('from') from?: string): Promise<RefRewardRecipientDto[]> {
    const fromDate = from ? new Date(from) : undefined;
    return this.dashboardFinancialService.getRefRewardRecipients(fromDate);
  }

  @Get('changes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getFinancialChanges(
    @Query('from') from?: string,
    @Query('dailySample') dailySample?: string,
  ): Promise<FinancialChangesResponseDto> {
    const fromDate = from ? new Date(from) : undefined;
    const sample = dailySample !== 'false';

    return this.dashboardFinancialService.getFinancialChanges(fromDate, sample);
  }
}
