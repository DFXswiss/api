import { Config } from 'src/config/config';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { WalletDto } from './dto/wallet.dto';
import { PaymentDto } from './dto/payment.dto';
import { LnUrlPLinkDto } from './dto/lnurlp-link.dto';
import { VerifyMessageDto } from './dto/verifymessage.dto';
import { VerifyMessageResponseDto } from './dto/verifymessage-response.dto';
import { LnUrlPLinkRemoveDto } from './dto/lnurlp-link-remove.dto';
import { Agent } from 'https';

export class LightningClient {
  constructor(private readonly http: HttpService) {}

  async getBalance(): Promise<number> {
    return this.getWallet().then((w) => w.balance);
  }

  private async getWallet(): Promise<WalletDto> {
    return this.http.get<WalletDto>(`${Config.blockchain.lightning.lnBitsApiUrl}/wallet`, this.httpLnBitsConfig);
  }

  async getPayments(checkingId: string): Promise<PaymentDto[]> {
    const limit = 5;
    let offset = 0;

    const result: PaymentDto[] = [];

    let running = true;

    while (running) {
      const paymentDtoArray = await this.http.get<PaymentDto[]>(
        `${Config.blockchain.lightning.lnBitsApiUrl}/payments?limit=${limit}&offset=${offset}&sortby=time&direction=desc`,
        this.httpLnBitsConfig,
      );

      running = 0 !== paymentDtoArray.length && this.fillPaymentArray(checkingId, paymentDtoArray, result);

      offset += limit;
    }

    return result;
  }

  private fillPaymentArray(
    checkingId: string,
    searchPaymentArray: PaymentDto[],
    foundPaymentArray: PaymentDto[],
  ): boolean {
    for (const searchPayment of searchPaymentArray) {
      if (searchPayment.checking_id === checkingId) {
        return false;
      }

      foundPaymentArray.push(searchPayment);
    }

    return true;
  }

  async getLnUrlPLinks(): Promise<LnUrlPLinkDto[]> {
    return this.http.get<LnUrlPLinkDto[]>(
      `${Config.blockchain.lightning.lnBitsLnUrlPApiUrl}/links?all_wallets=false`,
      this.httpLnBitsConfig,
    );
  }

  async addLnUrlPLink(description: string): Promise<LnUrlPLinkDto> {
    const newLnUrlPLinkDto: LnUrlPLinkDto = {
      description: description,
      min: 1,
      max: 100000000,
      comment_chars: 0,
      fiat_base_multiplier: 100,
    };

    return this.http.post<LnUrlPLinkDto>(
      `${Config.blockchain.lightning.lnBitsLnUrlPApiUrl}/links`,
      newLnUrlPLinkDto,
      this.httpLnBitsConfig,
    );
  }

  async removeLnUrlPLink(linkId: string): Promise<boolean> {
    return this.doRemoveLnUrlPLink(linkId).then((r) => r.success);
  }

  private async doRemoveLnUrlPLink(linkId: string): Promise<LnUrlPLinkRemoveDto> {
    return this.http.delete<LnUrlPLinkRemoveDto>(
      `${Config.blockchain.lightning.lnBitsLnUrlPApiUrl}/links/${linkId}`,
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
      `${Config.blockchain.lightning.lndApiUrl}/verifymessage`,
      verifyMessageDto,
      this.httpLndConfig,
    );
  }

  private get httpLnBitsConfig(): HttpRequestConfig {
    return {
      params: { 'api-key': `${Config.blockchain.lightning.lnBitsApiKey}` },
    };
  }

  private get httpLndConfig(): HttpRequestConfig {
    return {
      httpsAgent: new Agent({
        ca: `${Config.blockchain.lightning.lndCertificate}`,
      }),
      headers: { 'Grpc-Metadata-macaroon': `${Config.blockchain.lightning.lndAdminMacaroon}` },
    };
  }
}
