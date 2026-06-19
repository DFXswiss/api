import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LedgerAccountsResponseDto, LedgerLegsResponseDto } from '../dto/ledger-account.dto';
import { EquityComparisonDto, MarginResponseDto } from '../dto/ledger-margin.dto';
import {
  LedgerEquityComparisonQuery,
  LedgerLegsQuery,
  LedgerMarginQuery,
  LedgerPeriodQuery,
} from '../dto/ledger-query.dto';
import { ReconStatusResponseDto, SuspenseResponseDto } from '../dto/ledger-reconciliation.dto';
import { LedgerQueryService } from '../services/ledger-query.service';

// guard chain copied from dashboard-financial.controller.ts:24 (RoleGuard ADMIN, §1.4/§8 — NOT the DEBUG
// reconciliation controller). Base prefix dashboard/accounting → /v1/dashboard/accounting/ledger/* (§1.14).
@ApiTags('dashboard')
@Controller('dashboard/accounting')
export class LedgerController {
  constructor(private readonly ledgerQueryService: LedgerQueryService) {}

  @Get('ledger/accounts')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getAccounts(@Query() query: LedgerPeriodQuery): Promise<LedgerAccountsResponseDto> {
    return this.ledgerQueryService.getAccounts(query.from, query.to);
  }

  @Get('ledger/accounts/:accountId/legs')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getAccountDetail(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Query() query: LedgerLegsQuery,
  ): Promise<LedgerLegsResponseDto> {
    return this.ledgerQueryService.getAccountDetail(accountId, query.from, query.to, query.page);
  }

  @Get('ledger/reconciliation')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getReconStatus(): Promise<ReconStatusResponseDto> {
    return this.ledgerQueryService.getReconStatus();
  }

  @Get('ledger/suspense')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getSuspense(): Promise<SuspenseResponseDto> {
    return this.ledgerQueryService.getSuspense();
  }

  @Get('ledger/margin')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getMargin(@Query() query: LedgerMarginQuery): Promise<MarginResponseDto> {
    return this.ledgerQueryService.getMargin(query.from, query.to, query.dailySample !== 'false');
  }

  @Get('ledger/equity-comparison')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getEquityComparison(@Query() query: LedgerEquityComparisonQuery): Promise<EquityComparisonDto> {
    return this.ledgerQueryService.getEquityComparison(query.from, query.dailySample !== 'false');
  }
}
