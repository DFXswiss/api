import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { LnBitsTransactionDto } from 'src/integration/lightning/dto/lnbits.dto';
import { PayInWebHookService } from '../services/payin-webhhook.service';

@ApiTags('Payment Webhook')
@Controller('paymentWebhook')
export class PayInWebhookController {
  constructor(private readonly payInWebHookService: PayInWebHookService) {}

  @Post('transaction-webhook/:uniqueId')
  @ApiExcludeEndpoint()
  async transactionWebhook(
    @Param('uniqueId') uniqueId: string,
    @Body() transaction: LnBitsTransactionDto,
  ): Promise<void> {
    return this.payInWebHookService.processLightningTransaction({ uniqueId, transaction });
  }
}
