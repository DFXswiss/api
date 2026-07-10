import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { LnurlWithdrawRequestDto } from '../../../../integration/lightning/dto/lnurlw.dto';
import { LnUrlForwardService } from '../services/lnurl-forward.service';

@ApiTags('LNURL')
@Controller('lnurlw')
export class LnUrlWForwardController {
  constructor(private forwardService: LnUrlForwardService) {}

  @Get(':id')
  @UseGuards(RateLimitGuard)
  @Throttle(100, 60)
  async lnUrlWForward(@Param('id') id: string): Promise<LnurlWithdrawRequestDto> {
    return this.forwardService.lnurlwForward(id);
  }

  @Get('cb/:id')
  @UseGuards(RateLimitGuard)
  @Throttle(100, 60)
  async lnUrlWCallbackForward(@Param('id') id: string, @Query() params: any): Promise<any> {
    return this.forwardService.lnurlwCallbackForward(id, params);
  }
}
