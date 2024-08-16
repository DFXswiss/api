import { Injectable, NotFoundException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import {
  PaymentLinkEvmPaymentDto,
  PaymentLinkPayRequestDto,
  TransferInfo,
} from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentActivationService } from 'src/subdomains/core/payment-link/services/payment-activation.service';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { PaymentLinkService } from 'src/subdomains/core/payment-link/services/payment-link.service';
import { PaymentQuoteService } from 'src/subdomains/core/payment-link/services/payment-quote.service';
import { LnurlPayRequestDto, LnurlpInvoiceDto } from '../../../../integration/lightning/dto/lnurlp.dto';
import { LnurlWithdrawRequestDto, LnurlwInvoiceDto } from '../../../../integration/lightning/dto/lnurlw.dto';
import { LightningClient } from '../../../../integration/lightning/lightning-client';
import { LightningHelper } from '../../../../integration/lightning/lightning-helper';
import { LightningService } from '../../../../integration/lightning/services/lightning.service';

@Injectable()
export class LnUrlForwardService {
  private static readonly PAYMENT_LINK_PREFIX = `${PaymentLinkService.PREFIX_UNIQUE_ID}_`;
  private static readonly PAYMENT_LINK_PAYMENT_PREFIX = `${PaymentLinkPaymentService.PREFIX_UNIQUE_ID}_`;

  private readonly client: LightningClient;

  constructor(
    lightningService: LightningService,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly paymentQuoteService: PaymentQuoteService,
    private readonly paymentActivationService: PaymentActivationService,
  ) {
    this.client = lightningService.getDefaultClient();
  }

  // --- LNURLp --- //
  async lnurlpForward(id: string): Promise<LnurlPayRequestDto | PaymentLinkPayRequestDto> {
    if (
      id.startsWith(LnUrlForwardService.PAYMENT_LINK_PREFIX) ||
      id.startsWith(LnUrlForwardService.PAYMENT_LINK_PAYMENT_PREFIX)
    ) {
      return this.createPaymentLinkPayRequest(id);
    }

    return this.createLnurlpPayRequest(id);
  }

  async createPaymentLinkPayRequest(uniqueId: string): Promise<PaymentLinkPayRequestDto> {
    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(uniqueId);
    if (!pendingPayment) throw new NotFoundException('No pending payment found');

    const actualQuote = await this.paymentQuoteService.createQuote(pendingPayment);

    const btcTransferAmount = actualQuote.getTransferAmountFor(Blockchain.LIGHTNING, 'BTC');
    if (!btcTransferAmount) throw new NotFoundException('No BTC transfer amount found');

    const msatTransferAmount = LightningHelper.btcToMsat(btcTransferAmount.amount);

    const payRequest: PaymentLinkPayRequestDto = {
      tag: 'payRequest',
      callback: LightningHelper.createLnurlpCallbackUrl(uniqueId),
      minSendable: msatTransferAmount,
      maxSendable: msatTransferAmount,
      metadata: LightningHelper.createLnurlMetadata(pendingPayment.displayName),
      displayName: pendingPayment.displayName,
      quote: {
        id: actualQuote.uniqueId,
        expiration: actualQuote.expiryDate,
      },
      requestedAmount: {
        asset: pendingPayment.currency.name,
        amount: pendingPayment.amount,
      },
      transferAmounts: actualQuote.transferAmountsAsObj,
    };

    return payRequest;
  }

  private async createLnurlpPayRequest(lnurlpId: string): Promise<LnurlPayRequestDto> {
    const payRequest = await this.client.getLnurlpPaymentRequest(lnurlpId);

    payRequest.callback = LightningHelper.createLnurlpCallbackUrl(lnurlpId);

    return payRequest;
  }

  async lnurlpCallbackForward(id: string, params: any): Promise<LnurlpInvoiceDto | PaymentLinkEvmPaymentDto> {
    if (
      id.startsWith(LnUrlForwardService.PAYMENT_LINK_PREFIX) ||
      id.startsWith(LnUrlForwardService.PAYMENT_LINK_PAYMENT_PREFIX)
    ) {
      const transferInfo = this.getPaymentTransferInfo(params);
      return this.paymentActivationService.createPaymentActivationRequest(id, transferInfo);
    }

    return this.createLnurlpInvoice(id, params);
  }

  private async createLnurlpInvoice(id: string, params: any): Promise<LnurlpInvoiceDto> {
    return this.client.getLnurlpInvoice(id, params);
  }

  private getPaymentTransferInfo(params: any): TransferInfo {
    const isBtc = !params.asset || params.asset === 'BTC';

    const amount = params.amount ? Number(params.amount) : 0;
    const asset = isBtc ? 'BTC' : params.asset;
    const method = Util.toEnum(Blockchain, params.method) ?? Blockchain.LIGHTNING;

    return {
      method: method,
      asset: asset,
      amount: isBtc ? LightningHelper.msatToBtc(amount) : amount,
      quoteUniqueId: params.quote,
    };
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
