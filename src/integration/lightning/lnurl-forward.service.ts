import { Injectable } from '@nestjs/common';
import { Agent } from 'https';
import { Config } from 'src/config/config';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { LnurlPayCallbackDto } from './dto/lnurlp-pay-callback.dto';
import { LnurlPayRequestDto } from './dto/lnurlp-pay-request.dto';
import { LightningHelper } from './lightning-helper';

@Injectable()
export class LnUrlForwardService {
  constructor(private readonly http: HttpService) {}

  async lnurlpForward(id: string): Promise<LnurlPayRequestDto> {
    const lnBitsUrl = `${LightningHelper.lnurlpLnBitsBasePath}/${id}`;
    const payRequest = await this.http.get<LnurlPayRequestDto>(lnBitsUrl, this.getHttpLnBitsConfig());

    payRequest.callback = `${LightningHelper.lnurlpCallbackDfxApiBasePath}/${id}`;
    payRequest.metadata = '[["text/plain", "DFX Deposit Address"]]';

    return payRequest;
  }

  async lnurlpCallbackForward(id: string, params: any): Promise<LnurlPayCallbackDto> {
    const lnBitsCallbackUrl = `${LightningHelper.lnurlpCallbackLnBitsBasePath}/${id}`;
    return this.http.get<LnurlPayCallbackDto>(lnBitsCallbackUrl, this.getHttpLnBitsConfig(params));
  }

  private getHttpLnBitsConfig(params?: any): HttpRequestConfig {
    return {
      httpsAgent: new Agent({
        ca: Config.blockchain.lightning.certificate,
      }),

      params,
    };
  }
}
