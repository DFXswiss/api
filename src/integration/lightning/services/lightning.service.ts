import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { LnBitsInvoiceDto } from '../dto/lnbits.dto';
import { LndInfoDto, LndPaymentDto, LndRouteDto, LndSendPaymentResponseDto } from '../dto/lnd.dto';
import { LnurlpInvoiceDto } from '../dto/lnurlp.dto';
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
    if (address.startsWith(LightningAddressType.LN_URL)) {
      const invoice = await this.getInvoiceByLnurlp(address);
      return LightningHelper.getPublicKeyOfInvoice(invoice.pr);
    } else if (address.startsWith(LightningAddressType.LN_NID)) {
      return address.replace(LightningAddressType.LN_NID, '');
    } else if (address.startsWith(LightningAddressType.LND_HUB)) {
      const invoice = await this.getInvoiceByLndhub(address);
      return LightningHelper.getPublicKeyOfInvoice(invoice.payment_request);
    }

    throw new Error(`Cannot detect public key of address ${address}`);
  }

  async getInvoiceByLnurlp(lnurlpAddress: string, amount?: number): Promise<LnurlpInvoiceDto> {
    return this.client.getInvoiceByLnurlp(lnurlpAddress, amount);
  }

  async getInvoiceByLndhub(lndHubAddress: string, amount?: number): Promise<LnBitsInvoiceDto> {
    return this.client.getInvoiceByLndhub(lndHubAddress, amount);
  }

  async getLndInfo(): Promise<LndInfoDto> {
    return this.client.getLndInfo();
  }

  async getLndRoutes(publicKey: string, amount: number): Promise<LndRouteDto[]> {
    return this.client.getLndRoutes(publicKey, amount);
  }

  async sendPaymentByInvoice(invoice: string): Promise<LndSendPaymentResponseDto> {
    return this.client.sendPaymentByInvoice(invoice);
  }

  async sendPaymentByPublicKey(publicKey: string, amount: number): Promise<LndSendPaymentResponseDto> {
    return this.client.sendPaymentByPublicKey(publicKey, amount);
  }

  async listPayments(fromDate: number, toDate: number): Promise<LndPaymentDto[]> {
    return this.client.listPayments(fromDate, toDate);
  }
}
