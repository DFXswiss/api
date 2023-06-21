import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Agent } from 'https';
import { Config } from 'src/config/config';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { LnurlpPaymentData } from './data/lnurlp-payment.data';
import { LnBitsInvoiceDto, LnBitsWalletDto } from './dto/lnbits.dto';
import {
  LndChannelBalanceDto,
  LndInfoDto,
  LndPaymentsDto,
  LndSendPaymentResponseDto,
  LndWalletBalanceDto,
} from './dto/lnd.dto';
import { LnurlPayRequestDto, LnurlpInvoiceDto, LnurlpLinkDto, LnurlpLinkRemoveDto } from './dto/lnurlp.dto';
import { PaymentDto } from './dto/payment.dto';
import { LightningAddressType, LightningHelper } from './lightning-helper';

export class LightningClient {
  private static ALLOWED_LNDHUB_PATTERN = /^lndhub:\/\/invoice:(?<key>.+)@(?<url>https:\/\/.+)$/;

  constructor(private readonly http: HttpService) {}

  // --- LND --- //
  async getLndInfo(): Promise<LndInfoDto> {
    return this.http.get<LndInfoDto>(`${Config.blockchain.lightning.lnd.apiUrl}/getinfo`, this.httpLndConfig());
  }

  async getLndConfirmedWalletBalance(): Promise<number> {
    return this.getLndWalletBalance().then((b) => LightningHelper.satToBtc(b.confirmed_balance));
  }

  private async getLndWalletBalance(): Promise<LndWalletBalanceDto> {
    return this.http.get<LndWalletBalanceDto>(
      `${Config.blockchain.lightning.lnd.apiUrl}/balance/blockchain`,
      this.httpLndConfig(),
    );
  }

  async getLndLocalChannelBalance(): Promise<number> {
    return this.getLndChannelBalance().then((b) => LightningHelper.satToBtc(b.local_balance.sat));
  }

  async getLndRemoteChannelBalance(): Promise<number> {
    return this.getLndChannelBalance().then((b) => LightningHelper.satToBtc(b.remote_balance.sat));
  }

  private async getLndChannelBalance(): Promise<LndChannelBalanceDto> {
    return this.http.get<LndChannelBalanceDto>(
      `${Config.blockchain.lightning.lnd.apiUrl}/balance/channels`,
      this.httpLndConfig(),
    );
  }

  // --- LND Payments --- //
  async listPayments(fromDateInMillis: number, toDateInMillis: number): Promise<LndPaymentsDto> {
    const httpConfig = this.httpLndConfig();
    httpConfig.params = {
      creation_date_start: Math.floor(fromDateInMillis / 1000),
      creation_date_end: Math.floor(toDateInMillis / 1000),
    };

    return this.http.get<LndPaymentsDto>(`${Config.blockchain.lightning.lnd.apiUrl}/payments`, httpConfig);
  }

  async sendPaymentByInvoice(invoice: string): Promise<LndSendPaymentResponseDto> {
    return this.http.post<LndSendPaymentResponseDto>(
      `${Config.blockchain.lightning.lnd.apiUrl}/channels/transactions`,
      { payment_request: invoice },
      this.httpLndConfig(),
    );
  }

  async sendPaymentByPublicKey(publicKey: string, amount: number): Promise<LndSendPaymentResponseDto> {
    const preImage = randomBytes(32);
    const paymentHash = Util.createHash(preImage, 'sha256', 'base64');

    return this.http.post<LndSendPaymentResponseDto>(
      `${Config.blockchain.lightning.lnd.apiUrl}/channels/transactions`,
      {
        dest: Buffer.from(publicKey, 'hex').toString('base64'),
        amt: amount,
        final_cltv_delta: 0,
        payment_hash: paymentHash,
        dest_custom_records: { 5482373484: preImage.toString('base64') },
      },
      this.httpLndConfig(),
    );
  }

  // --- LnBits --- //
  async getLnBitsBalance(): Promise<number> {
    return this.getLnBitsWallet().then((w) => LightningHelper.msatToBtc(w.balance));
  }

  private async getLnBitsWallet(): Promise<LnBitsWalletDto> {
    return this.http.get<LnBitsWalletDto>(
      `${Config.blockchain.lightning.lnbits.apiUrl}/wallet`,
      this.httpLnBitsConfig(),
    );
  }

  async getInvoiceByLnurlp(lnurlpAddress: string, amount?: number): Promise<LnurlpInvoiceDto> {
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

  async getInvoiceByLndhub(lndHubAddress: string, amount?: number): Promise<LnBitsInvoiceDto> {
    const lnurlAddress = lndHubAddress.replace(LightningAddressType.LND_HUB, LightningAddressType.LN_URL);
    const lndHubPlain = LightningHelper.decodeLnurlp(lnurlAddress);

    const lndHubMatch = LightningClient.ALLOWED_LNDHUB_PATTERN.exec(lndHubPlain);

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

  // --- PAYMENTS --- //
  async getLnurlpPayments(checkingId: string): Promise<LnurlpPaymentData[]> {
    const batchSize = 5;
    let offset = 0;

    const result: LnurlpPaymentData[] = [];

    // get max. batchSize * 100 payments to avoid performance risks (getPayments() will be called every minute)
    for (let i = 0; i < 100; i++) {
      const url = `${Config.blockchain.lightning.lnbits.apiUrl}/payments?limit=${batchSize}&offset=${offset}&sortby=time&direction=desc`;
      const payments = await this.http.get<PaymentDto[]>(url, this.httpLnBitsConfig());

      // finish loop if there are no more payments available (offset is at the end of the payment list)
      if (!payments.length) break;

      const notPendingLnurlpPayments = payments.filter((p) => !p.pending).filter((p) => 'lnurlp' === p.extra.tag);

      // finish loop if there are no more not pending 'lnurlp' payments available
      if (!notPendingLnurlpPayments.length) break;

      const checkItemIndex = notPendingLnurlpPayments.findIndex((p) => p.checking_id === checkingId);

      if (checkItemIndex >= 0) {
        result.push(...this.createLnurlpPayments(notPendingLnurlpPayments.slice(0, checkItemIndex)));
        break;
      }

      result.push(...this.createLnurlpPayments(notPendingLnurlpPayments));

      offset += batchSize;
    }

    return result;
  }

  private createLnurlpPayments(paymentDtoArray: PaymentDto[]): LnurlpPaymentData[] {
    return paymentDtoArray.map((p) => ({
      paymentDto: p,
      lnurl: LightningHelper.createEncodedLnurlp(p.extra.link),
    }));
  }

  // --- PAYMENT LINKS --- //
  async getLnurlpLinks(): Promise<LnurlpLinkDto[]> {
    return this.http.get<LnurlpLinkDto[]>(
      `${Config.blockchain.lightning.lnbits.lnurlpApiUrl}/links?all_wallets=false`,
      this.httpLnBitsConfig(),
    );
  }

  async getLnurlpLink(linkId: string): Promise<LnurlpLinkDto> {
    return this.http.get<LnurlpLinkDto>(
      `${Config.blockchain.lightning.lnbits.lnurlpApiUrl}/links/${linkId}`,
      this.httpLnBitsConfig(),
    );
  }

  // --- LNURLP FORWARD --- //
  async getLnurlpPaymentRequest(linkId: string): Promise<LnurlPayRequestDto> {
    const lnBitsUrl = `${Config.blockchain.lightning.lnbits.lnurlpUrl}/${linkId}`;
    return this.http.get(lnBitsUrl, this.httpLnBitsConfig());
  }

  async getLnurlpInvoice(linkId: string, params: any): Promise<LnurlpInvoiceDto> {
    const lnBitsCallbackUrl = `${Config.blockchain.lightning.lnbits.lnurlpApiUrl}/lnurl/cb/${linkId}`;
    return this.http.get<LnurlpInvoiceDto>(lnBitsCallbackUrl, this.httpLnBitsConfig(params));
  }

  // --- LNURLP LINKS --- //
  async addLnurlpLink(description: string): Promise<LnurlpLinkDto> {
    if (!description) throw new Error('Description is undefined');

    const newLnurlpLinkDto: LnurlpLinkDto = {
      description: description,
      min: 1,
      max: 100000000,
      comment_chars: 0,
      fiat_base_multiplier: 100,
    };

    return this.http.post<LnurlpLinkDto>(
      `${Config.blockchain.lightning.lnbits.lnurlpApiUrl}/links`,
      newLnurlpLinkDto,
      this.httpLnBitsConfig(),
    );
  }

  async removeLnurlpLink(linkId: string): Promise<boolean> {
    return this.doRemoveLnurlpLink(linkId).then((r) => r.success);
  }

  private async doRemoveLnurlpLink(linkId: string): Promise<LnurlpLinkRemoveDto> {
    return this.http.delete<LnurlpLinkRemoveDto>(
      `${Config.blockchain.lightning.lnbits.lnurlpApiUrl}/links/${linkId}`,
      this.httpLnBitsConfig(),
    );
  }

  // --- HELPER METHODS --- //
  private httpLnBitsConfig(params?: any): HttpRequestConfig {
    return {
      httpsAgent: new Agent({
        ca: Config.blockchain.lightning.certificate,
      }),
      params: { 'api-key': Config.blockchain.lightning.lnbits.apiKey, ...params },
    };
  }

  private httpLndConfig(): HttpRequestConfig {
    return {
      httpsAgent: new Agent({
        ca: Config.blockchain.lightning.certificate,
      }),

      headers: { 'Grpc-Metadata-macaroon': Config.blockchain.lightning.lnd.adminMacaroon },
    };
  }
}
