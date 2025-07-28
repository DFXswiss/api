import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkDtoMapper } from 'src/subdomains/core/payment-link/dto/payment-link-dto.mapper';
import {
  PaymentLinkEvmPaymentDto,
  PaymentLinkHexResultDto,
  PaymentLinkPayRequestDto,
  PaymentLinkPaymentDto,
  TransferInfo,
} from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentLinkPaymentMode, PaymentStandard } from 'src/subdomains/core/payment-link/enums';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { PaymentLinkService } from 'src/subdomains/core/payment-link/services/payment-link.service';
import { PaymentQuoteService } from 'src/subdomains/core/payment-link/services/payment-quote.service';
import { LnurlPayRequestDto, LnurlpInvoiceDto } from '../../../../integration/lightning/dto/lnurlp.dto';
import { LnurlWithdrawRequestDto, LnurlwInvoiceDto } from '../../../../integration/lightning/dto/lnurlw.dto';
import { LightningClient } from '../../../../integration/lightning/lightning-client';
import { LightningHelper } from '../../../../integration/lightning/lightning-helper';
import { LightningService } from '../../../../integration/lightning/services/lightning.service';
import { PaymentDto } from '../dto/payment.dto';

@Injectable()
export class LnUrlForwardService {
  private readonly PAYMENT_LINK_PREFIX = `${Config.prefixes.paymentLinkUidPrefix}_`;
  private readonly PAYMENT_LINK_PAYMENT_PREFIX = `${Config.prefixes.paymentLinkPaymentUidPrefix}_`;

  private readonly client: LightningClient;

  constructor(
    lightningService: LightningService,
    private readonly paymentLinkService: PaymentLinkService,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly paymentQuoteService: PaymentQuoteService,
  ) {
    this.client = lightningService.getDefaultClient();
  }

  // --- LNURLp --- //
  // pay request
  async lnurlpForward(
    id: string,
    params: any,
  ): Promise<LnurlPayRequestDto | PaymentLinkPayRequestDto | LnurlpInvoiceDto | PaymentLinkEvmPaymentDto> {
    if (id.startsWith(this.PAYMENT_LINK_PREFIX) || id.startsWith(this.PAYMENT_LINK_PAYMENT_PREFIX)) {
      const payRequest = await this.paymentLinkService.createPayRequest(
        id,
        Util.toEnum(PaymentStandard, params.standard),
        params.timeout,
      );

      if (params.method) {
        // directly forward to lnurlp callback
        params.quote = payRequest.quote.id;
        return this.lnurlpCallbackForward(id, params);
      }

      return payRequest;
    }

    return this.createLnurlpPayRequest(id);
  }

  private async createLnurlpPayRequest(lnurlpId: string): Promise<LnurlPayRequestDto> {
    const payRequest = await this.client.getLnurlpPaymentRequest(lnurlpId);

    payRequest.callback = LightningHelper.createLnurlpCallbackUrl(lnurlpId);

    return payRequest;
  }

  // callback
  async lnurlpCallbackForward(id: string, params: any): Promise<LnurlpInvoiceDto | PaymentLinkEvmPaymentDto | any> {
    if (id.startsWith(this.PAYMENT_LINK_PREFIX) || id.startsWith(this.PAYMENT_LINK_PAYMENT_PREFIX)) {
      const transferInfo = this.getPaymentTransferInfo(params);
      
      // Handle ARK method
      if (params.method && params.method.toLowerCase() === 'ark') {
        const payment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(id);
        if (!payment) throw new NotFoundException('No pending payment found');
        
        const quote = await this.paymentQuoteService.getActualQuote(payment, transferInfo);
        if (!quote) throw new NotFoundException('Quote not found');
        
        // Get the ARK transfer amount from the quote
        const arkTransferAmount = quote.getTransferAmountFor('Ark' as any, 'BTC');
        const amount = arkTransferAmount?.amount || transferInfo.amount;
        
        return {
          expiryDate: quote.expiryDate.toISOString(),
          address: 'ark1qp9wsjfpsj5v5ex022v6tmhukkw3erjpv68xvl0af5zzukrk6dr529ecxra5lpyt4jfhqtnj4kmr3mtgg9urn55ffypduxwn5k454vpcgw3z44',
          asset: 'BTC',
          amount: amount.toString(),
          hint: 'Send the specified amount of sat in the specified time to the ark address given above.'
        };
      }
      
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
