import { BadRequestException, Controller, Get, Query, UseGuards, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { LnUrlForwardService } from '../services/lnurl-forward.service';

@ApiTags('Payment Link')
@Controller()
export class PaymentForwardController {
  constructor(private readonly forwardService: LnUrlForwardService) {}

  @Get('pl')
  @Version(VERSION_NEUTRAL)
  @ApiExcludeEndpoint()
  @UseGuards(RateLimitGuard)
  @Throttle(100, 60)
  async lnUrlPForward(@Query() params: any): Promise<any> {
    const lnurl = params.lightning;
    if (!lnurl) throw new BadRequestException('Missing lightning parameter');

    const id = LightningHelper.decodeLnurl(lnurl).split('/').at(-1);
    return this.forwardService.lnurlpForward(id, params);
  }
}
