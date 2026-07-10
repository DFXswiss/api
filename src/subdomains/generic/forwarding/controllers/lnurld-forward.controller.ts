import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LnurlwInvoiceDto, LnurlWithdrawRequestDto } from 'src/integration/lightning/dto/lnurlw.dto';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { LnUrlForwardService } from '../services/lnurl-forward.service';

@ApiTags('LNURL')
@Controller('lnurld')
export class LnurldForwardController {
  constructor(private readonly forwardService: LnUrlForwardService) {}

  @Get(':id')
  @UseGuards(RateLimitGuard)
  @Throttle(100, 60)
  async lnurldForward(@Param('id') id: string, @Query() params: any): Promise<LnurlWithdrawRequestDto> {
    return this.forwardService.lnurldForward(id, params);
  }

  @Get('cb/:id/:var')
  @UseGuards(RateLimitGuard)
  @Throttle(100, 60)
  async lnurldCallbackForward(
    @Param('id') id: string,
    @Param('var') variable: string,
    @Query() params: any,
  ): Promise<LnurlwInvoiceDto> {
    return this.forwardService.lnurldCallbackForward(id, variable, params);
  }
}
