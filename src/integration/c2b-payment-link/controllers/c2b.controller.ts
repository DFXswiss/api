import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { BinancePayWebhookGuard } from 'src/integration/c2b-payment-link/binance/guards/binance-pay-webhook.guard';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PayInWebHookService } from 'src/subdomains/supporting/payin/services/payin-webhhook.service';
import { BinancePayWebhookDto } from '../binance/dto/binance.dto';

@ApiTags('Payment Link')
@Controller('paymentLink')
export class C2BController {
  private readonly logger = new DfxLogger(C2BController);

  constructor(private readonly payInWebHookService: PayInWebHookService) {}

  @Post('integration/binance/webhook')
  @ApiExcludeEndpoint()
  @UseGuards(BinancePayWebhookGuard)
  async binancePayWebhook(@Body() dto: BinancePayWebhookDto): Promise<{ returnCode: string; returnMessage: string }> {
    this.payInWebHookService.processBinanceTransaction(dto);

    return { returnCode: 'SUCCESS', returnMessage: null };
  }
}
