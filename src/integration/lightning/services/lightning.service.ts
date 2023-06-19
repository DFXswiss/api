import { BadRequestException, Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { LndInfoDto } from '../dto/lnd-info.dto';
import { LndPaymentsDto } from '../dto/lnd-payment.dto';
import { LndSendPaymentResponseDto } from '../dto/lnd-sendpayment-response.dto';
import { LnurlpInvoiceDto } from '../dto/lnurlp-invoice.dto';
import { LnurlPayRequestDto } from '../dto/lnurlp-pay-request.dto';
import { LightningClient } from '../lightning-client';
import { LightningAddressType, LightningHelper } from '../lightning-helper';

@Injectable()
export class LightningService {
  private readonly logger = new DfxLogger(LightningService);

  private readonly client: LightningClient;

  constructor(private readonly http: HttpService) {
    this.client = new LightningClient(http);
  }

  getDefaultClient(): LightningClient {
    return this.client;
  }

  verifySignature(message: string, signature: string, publicKey: string): boolean {
    return LightningHelper.verifySignature(message, signature, publicKey);
  }

  async getPublicKeyOfAddress(address: string): Promise<string> {
    if (address.startsWith(LightningAddressType.LN_NID)) {
      // address is node pub key
      return address.replace(LightningAddressType.LN_NID, '');
    }

    const invoice = await this.getInvoice(address);
    return LightningHelper.getPublicKeyOfInvoice(invoice);
  }

  async getInvoice(lnurlpAddress: string, amount?: number): Promise<LnurlpInvoiceDto> {
    try {
      const lnurlpUrl = LightningHelper.decodeLnurlp(lnurlpAddress);

      const payRequest = await this.http.get<LnurlPayRequestDto>(lnurlpUrl);

      const payAmount = amount ? amount : payRequest.minSendable;

      if (payAmount < payRequest.minSendable) {
        throw new BadRequestException(`Pay amount ${payAmount} less than min sendable ${payRequest.minSendable}`);
      }

      return await this.http.get<LnurlpInvoiceDto>(payRequest.callback, {
        params: { amount: payAmount },
      });
    } catch {
      throw new BadRequestException(`Error while getting invoice of address ${lnurlpAddress}`);
    }
  }

  async getLndInfo(): Promise<LndInfoDto> {
    return this.client.getLndInfo();
  }

  async sendPaymentByInvoice(invoice: string): Promise<LndSendPaymentResponseDto> {
    return this.client.sendPaymentByInvoice(invoice);
  }

  async sendPaymentByPublicKey(publicKey: string, amount: number): Promise<LndSendPaymentResponseDto> {
    return this.client.sendPaymentByPublicKey(publicKey, amount);
  }

  async listPayments(fromDate: number, toDate: number): Promise<LndPaymentsDto> {
    return this.client.listPayments(fromDate, toDate);
  }
}
