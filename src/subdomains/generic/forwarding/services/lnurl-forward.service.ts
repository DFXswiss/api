import { Injectable, NotFoundException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkDtoMapper } from 'src/subdomains/core/payment-link/dto/payment-link-dto.mapper';
import {
  PaymentLinkEvmPaymentDto,
  PaymentLinkHexResultDto,
  PaymentLinkPaymentDto,
  PaymentLinkPayRequestDto,
  TransferInfo,
} from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentLinkPaymentMode, PaymentStandard } from 'src/subdomains/core/payment-link/enums';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { PaymentLinkService } from 'src/subdomains/core/payment-link/services/payment-link.service';
import { LnurlPayRequestDto, LnurlpInvoiceDto } from '../../../../integration/lightning/dto/lnurlp.dto';
import { LnurlwInvoiceDto, LnurlWithdrawRequestDto } from '../../../../integration/lightning/dto/lnurlw.dto';
import { LightningClient } from '../../../../integration/lightning/lightning-client';
import { LightningHelper } from '../../../../integration/lightning/lightning-helper';
import { LightningService } from '../../../../integration/lightning/services/lightning.service';
import { PaymentDto } from '../dto/payment.dto';

@Injectable()
export class LnUrlForwardService {
  private static readonly PAYMENT_LINK_PREFIX = `${PaymentLinkService.PREFIX_UNIQUE_ID}_`;
  private static readonly PAYMENT_LINK_PAYMENT_PREFIX = `${PaymentLinkPaymentService.PREFIX_UNIQUE_ID}_`;

  private readonly client: LightningClient;

  constructor(
    lightningService: LightningService,
    private readonly paymentLinkService: PaymentLinkService,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
  ) {
    this.client = lightningService.getDefaultClient();
  }

  // --- LNURLp --- //
  // pay request
  async lnurlpForward(id: string, params: any): Promise<LnurlPayRequestDto | PaymentLinkPayRequestDto> {
    if (
      id.startsWith(LnUrlForwardService.PAYMENT_LINK_PREFIX) ||
      id.startsWith(LnUrlForwardService.PAYMENT_LINK_PAYMENT_PREFIX)
    ) {
      return this.paymentLinkService.createPayRequest(
        id,
        Util.toEnum(PaymentStandard, params.standard),
        params.timeout,
      );
    }

    return this.createLnurlpPayRequest(id);
  }

  private async createLnurlpPayRequest(lnurlpId: string): Promise<LnurlPayRequestDto> {
    const payRequest = await this.client.getLnurlpPaymentRequest(lnurlpId);

    payRequest.callback = LightningHelper.createLnurlpCallbackUrl(lnurlpId);
    payRequest.externalId = (await this.client.getLnurlpLink(lnurlpId))?.id;

    return payRequest;
  }

  // callback
  async lnurlpCallbackForward(id: string, params: any): Promise<LnurlpInvoiceDto | PaymentLinkEvmPaymentDto> {
    if (
      id.startsWith(LnUrlForwardService.PAYMENT_LINK_PREFIX) ||
      id.startsWith(LnUrlForwardService.PAYMENT_LINK_PAYMENT_PREFIX)
    ) {
      const transferInfo = this.getPaymentTransferInfo(params);
      return this.paymentLinkPaymentService.createActivationRequest(id, transferInfo);
    }

    return this.createLnurlpInvoice(id, params);
  }

  private async createLnurlpInvoice(id: string, params: any): Promise<LnurlpInvoiceDto> {
    return this.client.getLnurlpInvoice(id, params);
  }

  async txHexForward(id: string, params: any): Promise<PaymentLinkHexResultDto> {
    const transferInfo = this.getPaymentTransferInfo(params);
    return this.paymentLinkPaymentService.handleHexPayment(id, transferInfo);
  }

  private getPaymentTransferInfo(params: any): TransferInfo {
    const isMsat = !params.asset;

    const amount = params.amount ? Number(params.amount) : 0;
    const asset = isMsat ? 'BTC' : params.asset;
    const method = Util.toEnum(Blockchain, params.method) ?? Blockchain.LIGHTNING;

    return {
      method,
      asset,
      amount: isMsat ? LightningHelper.msatToBtc(amount) : amount,
      quoteUniqueId: params.quote,
      tx: params.tx,
      hex: params.hex,
    };
  }

  // wait
  async waitForPayment(id: string): Promise<PaymentDto> {
    const payment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(id);
    if (!payment) throw new NotFoundException('No pending payment found');

    const updatedPayment = await this.paymentLinkPaymentService.waitForPayment(payment);

    return {
      status: updatedPayment.status,
    };
  }

  // cancel
  async cancelPayment(id: string): Promise<PaymentLinkPaymentDto> {
    const payment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(id);
    if (!payment) throw new NotFoundException('No pending payment found');

    if (payment.mode !== PaymentLinkPaymentMode.MULTIPLE) await this.paymentLinkPaymentService.cancelByPayment(payment);

    return PaymentLinkDtoMapper.toPaymentDto(payment);
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

  // --- LNURLd --- //
  async lnurldForward(deviceId: string, params: any): Promise<LnurlWithdrawRequestDto> {
    const withdrawRequest = await this.client.getLnurlDevice(deviceId, params);

    const [paymentId, variable] = withdrawRequest.callback.split('/').slice(-2);
    withdrawRequest.callback = LightningHelper.createLnurldCallbackUrl(paymentId, variable);

    return withdrawRequest;
  }

  async lnurldCallbackForward(id: string, variable: string, params: any): Promise<LnurlwInvoiceDto> {
    return this.client.getLnurlDeviceCallback(id, variable, params);
  }
}
