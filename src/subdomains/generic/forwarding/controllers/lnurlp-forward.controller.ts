import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LnurlPayRequestDto } from '../../../../integration/lightning/dto/lnurlp.dto';
import { PaymentDto } from '../dto/payment.dto';
import { LnUrlForwardService } from '../services/lnurl-forward.service';

@ApiTags('LNURL')
@Controller('lnurlp')
export class LnUrlPForwardController {
  constructor(private forwardService: LnUrlForwardService) {}

  @Get(':id')
  async lnUrlPForward(@Param('id') id: string, @Query() params: any): Promise<LnurlPayRequestDto> {
    return this.forwardService.lnurlpForward(id, params);
  }

  @Get('cb/:id')
  async lnUrlPCallbackForward(@Param('id') id: string, @Query() params: any): Promise<any> {
    return this.forwardService.lnurlpCallbackForward(id, params);
  }

  @Get('tx/:id')
  async txHexForward(@Param('id') id: string, @Query() params: any): Promise<any> {
    return this.forwardService.txHexForward(id, params);
  }

  @Get('wait/:id')
  async waitForPayment(@Param('id') id: string): Promise<PaymentDto> {
    return this.forwardService.waitForPayment(id);
  }
}
