import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler/dist/throttler.decorator';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PartnerStatisticDto, PartnerTimelineDto } from './dto/partner-statistic.dto';
import { PartnerStatisticRateLimitGuard } from './partner-statistic-rate-limit.guard';
import { PartnerStatisticGranularity } from './partner-statistic.enum';
import { PartnerStatisticService } from './partner-statistic.service';

@ApiTags('Statistic')
@Controller('statistic')
export class PartnerStatisticController {
  constructor(private readonly partnerStatisticService: PartnerStatisticService) {}

  @Get('partner')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.CLIENT_COMPANY, UserRole.PARTNER), PartnerStatisticRateLimitGuard)
  // 120 req/h per wallet: dashboard auto-refresh (~1/min) for summary + headroom
  @Throttle(120, 3600)
  @ApiOkResponse({ type: PartnerStatisticDto })
  @ApiQuery({
    name: 'from',
    required: false,
    description:
      'Period start (ISO date). Snapped to UTC day start. Default: start of the last 30 inclusive UTC calendar days ending on `to`.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Period end (ISO date). Snapped to exclusive UTC day end. Default: now.',
  })
  async getPartnerStatistics(
    @GetJwt() jwt: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<PartnerStatisticDto> {
    const walletId = await this.partnerStatisticService.resolveWalletId(jwt);
    return this.partnerStatisticService.getStatistics(walletId, from, to);
  }

  @Get('partner/timeline')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.CLIENT_COMPANY, UserRole.PARTNER), PartnerStatisticRateLimitGuard)
  // 120 req/h per wallet: same budget as summary so a dual-widget dashboard can refresh without 429s
  @Throttle(120, 3600)
  @ApiOkResponse({ type: PartnerTimelineDto })
  @ApiQuery({
    name: 'from',
    required: false,
    description:
      'Period start (ISO date). Snapped to UTC day start. Default: start of the last 30 inclusive UTC calendar days ending on `to`.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Period end (ISO date). Snapped to exclusive UTC day end. Default: now.',
  })
  @ApiQuery({
    name: 'granularity',
    required: false,
    enum: PartnerStatisticGranularity,
    description: 'Bucket size. Default: Day.',
  })
  async getPartnerTimeline(
    @GetJwt() jwt: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: PartnerStatisticGranularity,
  ): Promise<PartnerTimelineDto> {
    const walletId = await this.partnerStatisticService.resolveWalletId(jwt);
    return this.partnerStatisticService.getTimeline(walletId, from, to, granularity);
  }
}
