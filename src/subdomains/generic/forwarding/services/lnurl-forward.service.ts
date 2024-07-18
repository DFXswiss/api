import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import {
  PaymentLinkEvmPaymentDto,
  PaymentLinkPayRequestDto,
  TransferInfo,
} from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentActivationService } from 'src/subdomains/core/payment-link/services/payment-activation.service';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { PaymentLinkService } from 'src/subdomains/core/payment-link/services/payment-link.services';
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
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly paymentActivationService: PaymentActivationService,
  ) {
    this.client = lightningService.getDefaultClient();
  }

  // --- LNURLp --- //
  async lnurlpForward(id: string): Promise<LnurlPayRequestDto | PaymentLinkPayRequestDto> {
    if (id.startsWith(LnUrlForwardService.PAYMENT_LINK_PREFIX)) return this.createPaymentLinkPayRequest(id);

    return this.createLnurlpPayRequest(id);
  }

  private async createPaymentLinkPayRequest(paymentLinkId: string): Promise<PaymentLinkPayRequestDto> {
    const paymentLinkPaymentInfo = await this.paymentLinkPaymentService.getPaymentLinkForwardInfo(paymentLinkId);
    const metaData = `Payment to ${paymentLinkPaymentInfo.paymentLinkExternalId}: ${paymentLinkPaymentInfo.paymentLinkPaymentExternalId}`;

    const transferAmounts = paymentLinkPaymentInfo.transferAmounts;
    const btcTransferAmount = transferAmounts.find((ta) => ta.asset === 'BTC');
    if (!btcTransferAmount) throw new NotFoundException('No BTC transfer amount found');

    const satsSendable = LightningHelper.btcToSat(Util.round(btcTransferAmount.amount, 8));

    const payRequest: PaymentLinkPayRequestDto = {
      tag: 'payRequest',
      callback: LightningHelper.createLnurlpCallbackUrl(paymentLinkPaymentInfo.paymentLinkPaymentId),
      minSendable: satsSendable,
      maxSendable: satsSendable,
      metadata: `[["text/plain", "${metaData}"]]`,
      transferAmounts: transferAmounts,
    };

    return payRequest;
  }

  private async createLnurlpPayRequest(lnurlpId: string): Promise<LnurlPayRequestDto> {
    const payRequest = await this.client.getLnurlpPaymentRequest(lnurlpId);

    payRequest.callback = LightningHelper.createLnurlpCallbackUrl(lnurlpId);

    return payRequest;
  }

  async lnurlpCallbackForward(id: string, params: any): Promise<LnurlpInvoiceDto | PaymentLinkEvmPaymentDto> {
    if (id.startsWith(LnUrlForwardService.PAYMENT_LINK_PAYMENT_PREFIX)) {
      const transferInfo = this.getPaymentTransferInfo(params);
      return this.createPaymentLinkRequest(id, transferInfo);
    }

    return this.createLnurlpInvoice(id, params);
  }

  private async createPaymentLinkRequest(
    paymentLinkPaymentId: string,
    params: any,
  ): Promise<LnurlpInvoiceDto | PaymentLinkEvmPaymentDto> {
    const transferInfo = this.getPaymentTransferInfo(params);

    if (await await this.paymentActivationService.isDuplicate(transferInfo))
      throw new ConflictException(
        `Payment ${paymentLinkPaymentId}: Duplicate method ${transferInfo.method} and amount ${transferInfo.amount}`,
      );

    if (transferInfo.method === Blockchain.LIGHTNING) {
      return this.createPaymentLinkLightningPayment(paymentLinkPaymentId, transferInfo);
    }

    return this.createPaymentLinkEvmPayment(paymentLinkPaymentId, transferInfo);
  }

  private async createPaymentLinkLightningPayment(
    paymentLinkPaymentId: string,
    transferInfo: TransferInfo,
  ): Promise<LnurlpInvoiceDto> {
    const walletPaymentParams = await this.paymentActivationService.getLightningPaymentParams(
      paymentLinkPaymentId,
      transferInfo,
    );

    const lightningPayment = await this.client.getLnBitsWalletPayment(walletPaymentParams);

    await this.paymentActivationService.saveLightningPaymentRequest(
      paymentLinkPaymentId,
      lightningPayment.pr,
      transferInfo,
    );

    return lightningPayment;
  }

  private async createPaymentLinkEvmPayment(
    paymentLinkPaymentId: string,
    transferInfo: TransferInfo,
  ): Promise<PaymentLinkEvmPaymentDto> {
    const evmPayment = await this.paymentActivationService.getPaymentLinkEvmPaymentInfo(
      paymentLinkPaymentId,
      transferInfo,
    );

    await this.paymentActivationService.saveLightningPaymentRequest(paymentLinkPaymentId, evmPayment.uri, transferInfo);

    return evmPayment;
  }

  private async createLnurlpInvoice(id: string, params: any): Promise<LnurlpInvoiceDto> {
    return this.client.getLnurlpInvoice(id, params);
  }

  private getPaymentTransferInfo(params: any): TransferInfo {
    const method = Util.toEnum(Blockchain, params.method);

    return {
      asset: params.asset ?? 'BTC',
      amount: params.amount ?? 0,
      method: method ?? Blockchain.LIGHTNING,
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
