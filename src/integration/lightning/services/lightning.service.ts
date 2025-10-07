import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { LnBitsInvoiceDto } from '../dto/lnbits.dto';
import { LndPaymentDto, LndPaymentStatus, LndSendPaymentResponseDto } from '../dto/lnd.dto';
import { LnurlPayRequestDto, LnurlpInvoiceDto } from '../dto/lnurlp.dto';
import { LightningClient } from '../lightning-client';
import { LightningAddressType, LightningHelper } from '../lightning-helper';

@Injectable()
export class LightningService {
  private static ALLOWED_LNDHUB_PATTERN = /^lndhub:\/\/invoice:(?<key>.+)@(?<url>https:\/\/.+)$/;

  private readonly staticNodePublicKeys = {
    'dev.lightning.space': '02155cce4b9b62fbc5778976f38908dc84159126c66cb819c91d99a602c6bbb520',
  };

  private readonly client: LightningClient;
  private readonly addressPublicKeys = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);

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
    return this.addressPublicKeys.get(address, () => this.fetchPublicKeyOfAddress(address));
  }

  private async fetchPublicKeyOfAddress(address: string): Promise<string> {
    const addressType = LightningHelper.getAddressType(address);

    switch (addressType) {
      case LightningAddressType.LN_URL: {
        const url = new URL(LightningHelper.decodeLnurl(address));
        const staticKey = this.staticNodePublicKeys[url.host];
        if (staticKey) return staticKey;

        const invoice = await this.getInvoiceByLnurlp(address);
        return LightningHelper.getPublicKeyOfInvoice(invoice);
      }

      case LightningAddressType.LN_NID: {
        return address.replace(LightningAddressType.LN_NID, '');
      }

      case LightningAddressType.LND_HUB: {
        const invoice = await this.getInvoiceByLndhub(address);
        return LightningHelper.getPublicKeyOfInvoice(invoice);
      }

      default: {
        throw new Error(`Cannot detect public key of address ${address}`);
      }
    }
  }

  async getInvoiceByLnurlp(lnurlpAddress: string, amount?: number): Promise<string> {
    const lnurlpUrl = LightningHelper.decodeLnurl(lnurlpAddress);

    const payRequest = await this.http.get<LnurlPayRequestDto>(lnurlpUrl);

    amount = amount ? LightningHelper.btcToMsat(amount) : payRequest.minSendable;

    if (amount < payRequest.minSendable) {
      throw new BadRequestException(`Pay amount ${amount} less than min sendable ${payRequest.minSendable}`);
    }

    if (amount > payRequest.maxSendable) {
      throw new BadRequestException(`Pay amount ${amount} greater than max sendable ${payRequest.maxSendable}`);
    }

    return this.http
      .get<LnurlpInvoiceDto>(payRequest.callback, {
        params: { amount: amount },
      })
      .then((i) => i.pr);
  }

  async getInvoiceByLndhub(lndHubAddress: string, amount?: number): Promise<string> {
    const lnurlAddress = lndHubAddress.replace(LightningAddressType.LND_HUB, LightningAddressType.LN_URL);
    const lndHubPlain = LightningHelper.decodeLnurl(lnurlAddress);

    const lndHubMatch = LightningService.ALLOWED_LNDHUB_PATTERN.exec(lndHubPlain);

    if (!lndHubMatch) {
      throw new BadRequestException(`Invalid LNDHUB address ${lndHubPlain}`);
    }

    const invoiceKey = lndHubMatch.groups.key;
    const checkUrl = new URL(lndHubMatch.groups.url);

    return this.http
      .post<LnBitsInvoiceDto>(
        `https://${checkUrl.hostname}/api/v1/payments`,
        {
          out: false,
          amount: amount ? LightningHelper.btcToSat(amount) : 1,
          memo: 'Payment by DFX.swiss',
        },
        {
          headers: { 'X-Api-Key': invoiceKey, 'Content-Type': 'application/json' },
        },
      )
      .then((i) => i.payment_request);
  }

  async sendTransfer(address: string, amount: number): Promise<string> {
    const addressType = LightningHelper.getAddressType(address);

    let paymentResponse: LndSendPaymentResponseDto;

    switch (addressType) {
      case LightningAddressType.LN_URL: {
        const invoice = await this.getInvoiceByLnurlp(address, amount);
        paymentResponse = await this.client.sendPaymentByInvoice(invoice);
        break;
      }

      case LightningAddressType.LN_NID: {
        const publicKey = await this.getPublicKeyOfAddress(address);
        paymentResponse = await this.client.sendPaymentByPublicKey(publicKey, amount);
        break;
      }

      case LightningAddressType.LND_HUB: {
        const invoice = await this.getInvoiceByLndhub(address, amount);
        paymentResponse = await this.client.sendPaymentByInvoice(invoice);
        break;
      }

      default:
        throw new Error(`Unknown address type ${addressType} in send payment`);
    }

    if (paymentResponse.payment_error) {
      throw new Error(`Error while sending payment by LNURL ${address}: ${paymentResponse.payment_error}`);
    }

    return Buffer.from(paymentResponse.payment_hash, 'base64').toString('hex');
  }

  async getTransferCompletionData(txId: string, maxHours = 24): Promise<[boolean, number]> {
    const foundPayment = await this.findPayment(new Date(), maxHours, txId);

    let isComplete = false;
    let transferFee = 0;

    if (foundPayment) {
      isComplete = foundPayment.status === LndPaymentStatus.SUCCEEDED;
      transferFee = LightningHelper.satToBtc(foundPayment.fee_sat);
    }

    return [isComplete, transferFee];
  }

  private async findPayment(toDate: Date, maxHours: number, txId: string): Promise<LndPaymentDto> {
    let loopToDate = toDate;
    let loopFromDate = Util.hoursBefore(1, loopToDate);

    for (let hour = 0; hour < maxHours; hour++) {
      const payments = await this.client.listPayments(loopFromDate, loopToDate);
      const foundPayment = payments.find((p) => p.payment_hash === txId);

      if (foundPayment) return foundPayment;

      loopToDate = Util.hoursBefore(1, loopToDate);
      loopFromDate = Util.hoursBefore(1, loopToDate);
    }

    return null;
  }
}
