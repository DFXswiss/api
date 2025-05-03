import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentLinkPaymentDto } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentDto } from '../dto/payment.dto';
import { LnUrlForwardService } from '../services/lnurl-forward.service';

@ApiTags('LNURL')
@Controller('lnurlp')
export class LnUrlPForwardController {
  constructor(private readonly forwardService: LnUrlForwardService) {}

  @Get(':id')
  async lnUrlPForward(@Param('id') id: string, @Query() params: any): Promise<any> {
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

  @Delete('cancel/:id')
  async cancelPayment(@Param('id') id: string): Promise<PaymentLinkPaymentDto> {
    return this.forwardService.cancelPayment(id);
  }
}
