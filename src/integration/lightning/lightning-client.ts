import { Agent } from 'https';
import { Config } from 'src/config/config';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { LnurlpPaymentData } from './data/lnurlp-payment.data';
import { LnurlpInvoiceDto } from './dto/lnurlp-invoice.dto';
import { LnurlpLinkRemoveDto } from './dto/lnurlp-link-remove.dto';
import { LnurlpLinkDto } from './dto/lnurlp-link.dto';
import { LnurlPayRequestDto } from './dto/lnurlp-pay-request.dto';
import { PaymentDto } from './dto/payment.dto';
import { WalletDto } from './dto/wallet.dto';
import { LightningHelper } from './lightning-helper';

export class LightningClient {
  constructor(private readonly http: HttpService) {}

  // --- Wallet --- //
  async getBalance(): Promise<number> {
    return this.getWallet().then((w) => w.balance / 10 ** 3 / 10 ** 8);
  }

  private async getWallet(): Promise<WalletDto> {
    return this.http.get<WalletDto>(`${Config.blockchain.lightning.lnbits.apiUrl}/wallet`, this.httpLnBitsConfig());
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

  async getPaymentRequest(linkId: string): Promise<LnurlPayRequestDto> {
    const lnBitsUrl = `${Config.blockchain.lightning.lnbits.lnurlpUrl}/${linkId}`;
    return this.http.get(lnBitsUrl, this.httpLnBitsConfig());
  }

  async createInvoice(linkId: string, params: any): Promise<LnurlpInvoiceDto> {
    const lnBitsCallbackUrl = `${Config.blockchain.lightning.lnbits.lnurlpApiUrl}/lnurl/cb/${linkId}`;
    return this.http.get<LnurlpInvoiceDto>(lnBitsCallbackUrl, this.httpLnBitsConfig(params));
  }

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
}
