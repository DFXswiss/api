import { BadRequestException, Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { LnBitsInvoiceDto } from '../dto/lnbits.dto';
import { LnurlPayRequestDto, LnurlpInvoiceDto } from '../dto/lnurlp.dto';
import { LightningClient } from '../lightning-client';
import { LightningAddressType, LightningHelper } from '../lightning-helper';

@Injectable()
export class LightningService {
  private readonly logger = new DfxLogger(LightningService);

  private static ALLOWED_LNDHUB_PATTERN = /^lndhub:\/\/invoice:(?<key>.+)@(?<url>https:\/\/.+)$/;

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
    const addressType = LightningHelper.getAddressType(address);

    switch (addressType) {
      case LightningAddressType.LN_URL: {
        const invoice = await this.getInvoiceByLnurlp(address);
        return LightningHelper.getPublicKeyOfInvoice(invoice.pr);
      }

      case LightningAddressType.LN_NID: {
        return address.replace(LightningAddressType.LN_NID, '');
      }

      case LightningAddressType.LND_HUB: {
        const invoice = await this.getInvoiceByLndhub(address);
        return LightningHelper.getPublicKeyOfInvoice(invoice.payment_request);
      }

      default: {
        throw new Error(`Cannot detect public key of address ${address}`);
      }
    }
  }

  async getInvoiceByLnurlp(lnurlpAddress: string, amount?: number): Promise<LnurlpInvoiceDto> {
    try {
      const lnurlpUrl = LightningHelper.decodeLnurlp(lnurlpAddress);

      const payRequest = await this.http.get<LnurlPayRequestDto>(lnurlpUrl);
      amount ??= payRequest.minSendable;

      if (amount < payRequest.minSendable) {
        throw new BadRequestException(`Pay amount ${amount} less than min sendable ${payRequest.minSendable}`);
      }

      if (amount > payRequest.maxSendable) {
        throw new BadRequestException(`Pay amount ${amount} greater than max sendable ${payRequest.maxSendable}`);
      }

      return await this.http.get<LnurlpInvoiceDto>(payRequest.callback, {
        params: { amount: amount },
      });
    } catch {
      throw new BadRequestException(`Error while getting invoice of address ${lnurlpAddress}`);
    }
  }

  async getInvoiceByLndhub(lndHubAddress: string, amount?: number): Promise<LnBitsInvoiceDto> {
    const lnurlAddress = lndHubAddress.replace(LightningAddressType.LND_HUB, LightningAddressType.LN_URL);
    const lndHubPlain = LightningHelper.decodeLnurlp(lnurlAddress);

    const lndHubMatch = LightningService.ALLOWED_LNDHUB_PATTERN.exec(lndHubPlain);

    if (!lndHubMatch) {
      throw new BadRequestException(`Invalid LNDHUB address ${lndHubPlain}`);
    }

    const invoiceKey = lndHubMatch.groups.key;
    const checkUrl = new URL(lndHubMatch.groups.url);

    return this.http.post<LnBitsInvoiceDto>(
      `https://${checkUrl.hostname}/api/v1/payments`,
      {
        out: false,
        amount: amount ? LightningHelper.btcToSat(amount) : 1,
        memo: 'Payment by DFX.swiss',
      },
      {
        headers: { 'X-Api-Key': invoiceKey, 'Content-Type': 'application/json' },
      },
    );
  }
}
