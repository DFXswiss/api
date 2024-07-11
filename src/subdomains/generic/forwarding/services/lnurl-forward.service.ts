import { Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkService } from 'src/subdomains/core/payment-link/services/payment-link.services';
import { LnurlPayRequestDto, LnurlpInvoiceDto } from '../../../../integration/lightning/dto/lnurlp.dto';
import { LnurlWithdrawRequestDto, LnurlwInvoiceDto } from '../../../../integration/lightning/dto/lnurlw.dto';
import { LightningClient } from '../../../../integration/lightning/lightning-client';
import { LightningHelper } from '../../../../integration/lightning/lightning-helper';
import { LightningService } from '../../../../integration/lightning/services/lightning.service';

@Injectable()
export class LnUrlForwardService {
  private static readonly PAYMENT_LINK_PREFIX = 'pl_';
  private static readonly PAYMENT_LINK_PAYMENT_PREFIX = 'plp_';

  private readonly client: LightningClient;

  constructor(lightningService: LightningService, private readonly paymentLinkService: PaymentLinkService) {
    this.client = lightningService.getDefaultClient();
  }

  // --- LNURLp --- //
  async lnurlpForward(id: string): Promise<LnurlPayRequestDto> {
    if (id.startsWith(LnUrlForwardService.PAYMENT_LINK_PREFIX)) return this.doPaymentLinkForward(id);

    return this.doLnurlpForward(id);
  }

  async lnurlpCallbackForward(id: string, params: any): Promise<LnurlpInvoiceDto> {
    return this.client.getLnurlpInvoice(id, params);
  }

  private async doLnurlpForward(id: string): Promise<LnurlPayRequestDto> {
    const payRequest = await this.client.getLnurlpPaymentRequest(id);

    payRequest.callback = LightningHelper.createLnurlpCallbackUrl(id);

    return payRequest;
  }

  private async doPaymentLinkForward(paymentId: string): Promise<LnurlPayRequestDto> {
    const paymentLinkPaymentInfo = await this.paymentLinkService.getPaymentLinkPaymentInfo(paymentId);
    const metaData = `Payment to ${paymentLinkPaymentInfo.paymentLinkExternalId}: ${paymentLinkPaymentInfo.paymentLinkPaymentExternalId}`;

    const transferAmounts = paymentLinkPaymentInfo.transferAmounts;
    const btcTransferAmount = transferAmounts.find((ta) => ta.asset === 'BTC');
    if (!btcTransferAmount) throw new NotFoundException('No BTC transfer amount found');

    const satsSendable = LightningHelper.btcToSat(Util.round(btcTransferAmount.amount, 8));

    const payRequest: LnurlPayRequestDto = {
      tag: 'payRequest',
      callback: LightningHelper.createLnurlpCallbackUrl(paymentLinkPaymentInfo.paymentLinkPaymentId),
      minSendable: satsSendable,
      maxSendable: satsSendable,
      metadata: `[["text/plain", "${metaData}"]]`,
      transferAmounts: transferAmounts,
    };

    return payRequest;
  }

  // --- LNURLw --- //
  async lnurlwForward(id: string): Promise<LnurlWithdrawRequestDto> {
    const withdrawRequest = await this.client.getLnurlwWithdrawRequest(id);

    withdrawRequest.callback = LightningHelper.createLnurlwCallbackUrl(id);

    return withdrawRequest;
  }

  async lnurlwCallbackForward(id: string, params: any): Promise<LnurlwInvoiceDto> {
    return this.client.sendLnurlwInvoice(id, params);
  }
}
