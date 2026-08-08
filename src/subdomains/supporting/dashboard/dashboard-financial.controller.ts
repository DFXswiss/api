import { BadRequestException, Controller, Get, NotFoundException, Query, UseGuards } from '@nestjs/common';
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

// The two endpoints the Financial Overview screen reads — `log` and `latest` — additionally admit
// UserRole.DEBUG. Both roles sit in KycGatedRoles, so `RoleGuard.isElevated` stays true and the staff
// KYC clearance keeps applying unchanged; this widens who may read the aggregates, not how.
// Deliberately NOT widened: `ref-recipients` returns userDataId per recipient, which is a reference to
// a person rather than an aggregate; `changes` backs the History and Expenses screens; and
// `changes/latest` has no consumer at all today, so there is nothing asking for it to be opened.
@ApiTags('dashboard')
@Controller('dashboard/financial')
export class DashboardFinancialController {
  constructor(private readonly dashboardFinancialService: DashboardFinancialService) {}

  @Get('log')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN, UserRole.DEBUG), UserActiveGuard())
  async getFinancialLog(
    @Query('from') from?: string,
    @Query('dailySample') dailySample?: string,
    @Query('byType') byType?: string,
  ): Promise<FinancialLogResponseDto> {
    const fromDate = this.parseDate(from);
    const sample = dailySample !== 'false';
    const includeByType = byType !== 'false';

    return this.dashboardFinancialService.getFinancialLog(fromDate, sample, includeByType);
  }

  @Get('latest')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN, UserRole.DEBUG), UserActiveGuard())
  async getLatestBalance(): Promise<LatestBalanceResponseDto> {
    const result = await this.dashboardFinancialService.getLatestBalance();
    if (!result) throw new NotFoundException('No financial data available');
    return result;
  }

  @Get('changes/latest')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getLatestChanges(): Promise<FinancialChangesEntryDto> {
    const result = await this.dashboardFinancialService.getLatestFinancialChanges();
    if (!result) throw new NotFoundException('No financial changes available');
    return result;
  }

  @Get('ref-recipients')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getRefRewardRecipients(@Query('from') from?: string): Promise<RefRewardRecipientDto[]> {
    return this.dashboardFinancialService.getRefRewardRecipients(this.parseDate(from));
  }

  @Get('changes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getFinancialChanges(
    @Query('from') from?: string,
    @Query('dailySample') dailySample?: string,
  ): Promise<FinancialChangesResponseDto> {
    const sample = dailySample !== 'false';

    return this.dashboardFinancialService.getFinancialChanges(this.parseDate(from), sample);
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (isNaN(date.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
    return date;
  }
}
