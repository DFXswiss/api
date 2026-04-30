import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreatePaymentLinkPaymentDto } from 'src/subdomains/core/payment-link/dto/create-payment-link-payment.dto';
import { PaymentLinkPayRequestDto, PaymentLinkPaymentDto } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
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

  @Post(':id')
  async activatePublicPayment(
    @Param('id') id: string,
    @Body() dto: CreatePaymentLinkPaymentDto,
  ): Promise<PaymentLinkPayRequestDto> {
    return this.forwardService.activatePublicPayment(id, dto);
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
