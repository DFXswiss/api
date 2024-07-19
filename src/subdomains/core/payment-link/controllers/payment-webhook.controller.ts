import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { LnBitsTransactionDto } from 'src/integration/lightning/dto/lnbits.dto';
import { PaymentWebHookService } from '../services/payment-webhhook.service';

@ApiTags('Payment Webhook')
@Controller('paymentWebhook')
export class PaymentWebhookController {
  constructor(private readonly paymentWebHookService: PaymentWebHookService) {}

  @Post('transaction-webhook/:plpUniqueId')
  @ApiExcludeEndpoint()
  async transactionWebhook(
    @Param('plpUniqueId') plpUniqueId: string,
    @Body() transaction: LnBitsTransactionDto,
  ): Promise<void> {
    return this.paymentWebHookService.processLightningTransaction({ plpUniqueId, transaction });
  }
}
