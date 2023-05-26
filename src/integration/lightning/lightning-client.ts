import { Config } from 'src/config/config';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { WalletDto } from './dto/wallet.dto';
import { PaymentDto } from './dto/payment.dto';
import { LnUrlPLinkDto } from './dto/lnurlp-link.dto';
import { VerifyMessageDto } from './dto/verifymessage.dto';
import { VerifyMessageResponseDto } from './dto/verifymessage-response.dto';
import { LnUrlPLinkRemoveDto } from './dto/lnurlp-link-remove.dto';
import { Agent } from 'https';
import { LnUrlPPaymentData } from './data/lnurlp-payment.data';
import { LightningHelper } from './lightning-helper';

export class LightningClient {
  constructor(private readonly http: HttpService) {}

  async getBalance(): Promise<number> {
    return this.getWallet().then((w) => w.balance / 10 ** 3);
  }

  private async getWallet(): Promise<WalletDto> {
    return this.http.get<WalletDto>(`${Config.blockchain.lightning.lnbits.apiUrl}/wallet`, this.httpLnBitsConfig);
  }

  async getLnUrlPPayments(checkingId: string): Promise<LnUrlPPaymentData[]> {
    const batchSize = 5;
    let offset = 0;

    const result: LnUrlPPaymentData[] = [];

    // get max. batchSize * 100 payments to avoid performance risks (getPayments() will be called every minute)
    for (let i = 0; i < 100; i++) {
      const url = `${Config.blockchain.lightning.lnbits.apiUrl}/payments?limit=${batchSize}&offset=${offset}&sortby=time&direction=desc`;
      const paymentDtoArray = await this.http.get<PaymentDto[]>(url, this.httpLnBitsConfig);

      // finish loop if there are no more payments available (offset is at the end of the payment list)
      if (!paymentDtoArray.length) break;

      const notPendingLnUrlPPaymentDtoArray = paymentDtoArray
        .filter((p) => !p.pending)
        .filter((p) => 'lnurlp' === p.extra.tag);

      // finish loop if there are no more not pending 'lnurlp' payments available
      if (!notPendingLnUrlPPaymentDtoArray.length) break;

      const checkItemIndex = notPendingLnUrlPPaymentDtoArray.findIndex((p) => p.checking_id === checkingId);

      if (checkItemIndex >= 0) {
        result.push(...this.createLnUrlPPaymentDataArray(notPendingLnUrlPPaymentDtoArray.slice(0, checkItemIndex)));
        break;
      }

      result.push(...this.createLnUrlPPaymentDataArray(notPendingLnUrlPPaymentDtoArray));

      offset += batchSize;
    }

    return result;
  }

  private createLnUrlPPaymentDataArray(paymentDtoArray: PaymentDto[]): LnUrlPPaymentData[] {
    return paymentDtoArray.map((p) => ({
      paymentDto: p,
      lnurl: LightningHelper.createEncodedLnUrlP(p.extra.link),
    }));
  }

  async getLnUrlPLinks(): Promise<LnUrlPLinkDto[]> {
    return this.http.get<LnUrlPLinkDto[]>(
      `${Config.blockchain.lightning.lnbits.lnUrlPApiUrl}/links?all_wallets=false`,
      this.httpLnBitsConfig,
    );
  }

  async getLnUrlPLink(linkId: string): Promise<LnUrlPLinkDto> {
    return this.http.get<LnUrlPLinkDto>(
      `${Config.blockchain.lightning.lnbits.lnUrlPApiUrl}/links/${linkId}`,
      this.httpLnBitsConfig,
    );
  }

  async addLnUrlPLink(description: string): Promise<LnUrlPLinkDto> {
    if (!description) return null;

    const newLnUrlPLinkDto: LnUrlPLinkDto = {
      description: description,
      min: 1,
      max: 100000000,
      comment_chars: 0,
      fiat_base_multiplier: 100,
    };

    return this.http.post<LnUrlPLinkDto>(
      `${Config.blockchain.lightning.lnbits.lnUrlPApiUrl}/links`,
      newLnUrlPLinkDto,
      this.httpLnBitsConfig,
    );
  }

  async removeLnUrlPLink(linkId: string): Promise<boolean> {
    return this.doRemoveLnUrlPLink(linkId).then((r) => r.success);
  }

  private async doRemoveLnUrlPLink(linkId: string): Promise<LnUrlPLinkRemoveDto> {
    return this.http.delete<LnUrlPLinkRemoveDto>(
      `${Config.blockchain.lightning.lnbits.lnUrlPApiUrl}/links/${linkId}`,
      this.httpLnBitsConfig,
    );
  }

  async verifySignature(message: string, signature: string): Promise<boolean> {
    return this.doVerifySignature(message, signature).then((v) => v.valid);
  }

  private async doVerifySignature(message: string, signature: string): Promise<VerifyMessageResponseDto> {
    const messageHash = Buffer.from(message).toString('base64');

    const verifyMessageDto: VerifyMessageDto = {
      msg: messageHash,
      signature: signature,
    };

    return this.http.post(
      `${Config.blockchain.lightning.lnd.apiUrl}/verifymessage`,
      verifyMessageDto,
      this.httpLndConfig,
    );
  }

  private get httpLnBitsConfig(): HttpRequestConfig {
    return {
      params: { 'api-key': `${Config.blockchain.lightning.lnbits.apiKey}` },
    };
  }

  private get httpLndConfig(): HttpRequestConfig {
    return {
      httpsAgent: new Agent({
        ca: `${Config.blockchain.lightning.lnd.certificate}`,
      }),
      headers: { 'Grpc-Metadata-macaroon': `${Config.blockchain.lightning.lnd.adminMacaroon}` },
    };
  }
}
