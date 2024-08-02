import { Body, Controller, ForbiddenException, Headers, Param, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { LnBitsWebhookMapper } from 'src/integration/lightning/dto/lnbits-webhook.mapper';
import { LnBitsTransactionDto } from 'src/integration/lightning/dto/lnbits.dto';
import { LnurlpTransactionDto } from 'src/integration/lightning/dto/lnurlp.dto';
import { Util } from 'src/shared/utils/util';
import { PayInWebHookService } from '../services/payin-webhhook.service';

@ApiTags('Payment Webhook')
@Controller('paymentWebhook')
export class PayInWebhookController {
  constructor(private readonly payInWebHookService: PayInWebHookService) {}

  @Post('lnurlpDeposit/:uniqueId')
  @ApiExcludeEndpoint()
  async deposit(
    @Headers('Deposit-Signature') depositSignature: string,
    @Param('uniqueId') uniqueId: string,
    @Body() transaction: LnurlpTransactionDto,
  ): Promise<void> {
    if (!Util.verifySign(uniqueId, Config.dfx.signingPubKey, depositSignature ?? ''))
      throw new ForbiddenException('Access denied');

    return this.payInWebHookService.processLightningTransaction(
      LnBitsWebhookMapper.mapDepositTransaction(uniqueId, transaction),
    );
  }

  @Post('lnurlpPayment/:uniqueId')
  @ApiExcludeEndpoint()
  async payment(@Param('uniqueId') uniqueId: string, @Body() transaction: LnBitsTransactionDto): Promise<void> {
    const paymentSignature = transaction.extra?.signature;

    if (!Util.verifySign(uniqueId, Config.dfx.signingPubKey, paymentSignature ?? ''))
      throw new ForbiddenException('Access denied');

    return this.payInWebHookService.processLightningTransaction(
      LnBitsWebhookMapper.mapPaymentTransaction(uniqueId, transaction),
    );
  }
}
