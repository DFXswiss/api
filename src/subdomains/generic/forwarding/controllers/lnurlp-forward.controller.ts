import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { CreatePaymentLinkPaymentDto } from 'src/subdomains/core/payment-link/dto/create-payment-link-payment.dto';
import { PaymentLinkPayRequestDto, PaymentLinkPaymentDto } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentDto } from '../dto/payment.dto';
import { LnUrlForwardService } from '../services/lnurl-forward.service';

@ApiTags('LNURL')
@Controller('lnurlp')
export class LnUrlPForwardController {
  constructor(private readonly forwardService: LnUrlForwardService) {}

  @Get(':id')
  @UseGuards(RateLimitGuard)
  @Throttle(100, 60)
  async lnUrlPForward(@Param('id') id: string, @Query() params: any): Promise<any> {
    return this.forwardService.lnurlpForward(id, params);
  }

  @Post(':id')
  @UseGuards(RateLimitGuard)
  @Throttle(100, 60)
  async activatePublicPayment(
    @Param('id') id: string,
    @Body() dto: CreatePaymentLinkPaymentDto,
  ): Promise<PaymentLinkPayRequestDto> {
    return this.forwardService.activatePublicPayment(id, dto);
  }

  @Get('cb/:id')
  @UseGuards(RateLimitGuard)
  @Throttle(100, 60)
  async lnUrlPCallbackForward(@Param('id') id: string, @Query() params: any): Promise<any> {
    return this.forwardService.lnurlpCallbackForward(id, params);
  }

  @Get('tx/:id')
  @UseGuards(RateLimitGuard)
  @Throttle(100, 60)
  async txHexForward(@Param('id') id: string, @Query() params: any): Promise<any> {
    return this.forwardService.txHexForward(id, params);
  }

  @Get('wait/:id')
  @UseGuards(RateLimitGuard)
  @Throttle(100, 60)
  async waitForPayment(@Param('id') id: string): Promise<PaymentDto> {
    return this.forwardService.waitForPayment(id);
  }

  @Delete('cancel/:id')
  @UseGuards(RateLimitGuard)
  @Throttle(100, 60)
  async cancelPayment(@Param('id') id: string): Promise<PaymentLinkPaymentDto> {
    return this.forwardService.cancelPayment(id);
  }
}
