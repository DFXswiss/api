import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import {
  PaymentLinkEvmHexPaymentDto,
  PaymentLinkEvmPaymentDto,
  PaymentLinkPayRequestDto,
  TransferInfo,
} from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentStandard } from 'src/subdomains/core/payment-link/enums';
import { PaymentActivationService } from 'src/subdomains/core/payment-link/services/payment-activation.service';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { PaymentLinkService } from 'src/subdomains/core/payment-link/services/payment-link.service';
import { PaymentQuoteService } from 'src/subdomains/core/payment-link/services/payment-quote.service';
import { LnurlPayRequestDto, LnurlpInvoiceDto } from '../../../../integration/lightning/dto/lnurlp.dto';
import { LnurlwInvoiceDto, LnurlWithdrawRequestDto } from '../../../../integration/lightning/dto/lnurlw.dto';
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
    private readonly paymentLinkService: PaymentLinkService,
    private readonly paymentQuoteService: PaymentQuoteService,
    private readonly paymentActivationService: PaymentActivationService,
  ) {
    this.client = lightningService.getDefaultClient();
  }

  // --- LNURLp --- //
  async lnurlpForward(id: string, params: any): Promise<LnurlPayRequestDto | PaymentLinkPayRequestDto> {
    if (
      id.startsWith(LnUrlForwardService.PAYMENT_LINK_PREFIX) ||
      id.startsWith(LnUrlForwardService.PAYMENT_LINK_PAYMENT_PREFIX)
    ) {
      return this.paymentLinkService.createPaymentLinkPayRequest(id, Util.toEnum(PaymentStandard, params.standard));
    }

    return this.createLnurlpPayRequest(id);
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

  async txHexForward(id: string, params: any): Promise<PaymentLinkEvmHexPaymentDto> {
    const transferInfo = this.getPaymentTransferInfo(params);
    return this.paymentQuoteService.executeHexPayment(id, transferInfo);
  }

  private getPaymentTransferInfo(params: any): TransferInfo {
    const standard = Util.toEnum(PaymentStandard, params.standard) ?? PaymentStandard.OPEN_CRYPTO_PAY;

    const isMsat = !params.asset;

    const amount = params.amount ? Number(params.amount) : 0;
    const asset = isMsat ? 'BTC' : params.asset;
    const method = Util.toEnum(Blockchain, params.method) ?? Blockchain.LIGHTNING;

    return {
      standard,
      method,
      asset,
      amount: isMsat ? LightningHelper.msatToBtc(amount) : amount,
      quoteUniqueId: params.quote,
      hex: params.hex,
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
