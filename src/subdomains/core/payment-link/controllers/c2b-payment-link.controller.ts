import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { BinancePayWebhookGuard } from 'src/integration/binance-pay/guards/binance-pay-webhook.guard';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { PayInWebHookService } from 'src/subdomains/supporting/payin/services/payin-webhhook.service';
import { BinancePayWebhookDto } from '../../../../integration/binance-pay/dto/binance.dto';
import { C2BPaymentLinkService } from '../services/c2b-payment-link.service';
import { PaymentLinkService } from '../services/payment-link.service';
import { C2BPaymentStatus } from '../share/PaymentStatus';
import { C2BPaymentProvider } from '../share/providers.enum';

@ApiTags('Payment Link')
@Controller('paymentLink')
export class C2BPaymentLinkController {
  private readonly logger = new DfxLogger(C2BPaymentLinkController);

  constructor(
    private readonly paymentLinkService: PaymentLinkService,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly c2bPaymentLinkService: C2BPaymentLinkService,
    private readonly payInWebHookService: PayInWebHookService,
  ) {}

  @Post('integration/binance/activate/:id')
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async activateBinancePay(@Param('id') id: string): Promise<void> {
    await this.paymentLinkService.activateC2BPaymentLink(id, C2BPaymentProvider.BINANCE_PAY);
  }

  @Post('integration/binance/webhook')
  @ApiExcludeEndpoint()
  @UseGuards(BinancePayWebhookGuard)
  async binancePayWebhook(@Body() dto: BinancePayWebhookDto): Promise<{ returnCode: string; returnMessage: string }> {
    const result = await this.c2bPaymentLinkService.handleWebhook(C2BPaymentProvider.BINANCE_PAY, dto);

    if (result) {
      switch (result.status) {
        case C2BPaymentStatus.WAITING:
          await this.paymentLinkPaymentService.handleBinanceWaiting(result);
          break;

        case C2BPaymentStatus.COMPLETED:
          this.payInWebHookService.processBinanceTransaction(result);
          break;
      }
    }

    return { returnCode: 'SUCCESS', returnMessage: null };
  }
}
