import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { LnurlPayRequestDto } from './dto/lnurlp-pay-request.dto';
import { LightningHelper } from './lightning-helper';
import { LnurlPayCallbackDto } from './dto/lnurlp-pay-callback.dto';

@Injectable()
export class LnUrlForwardService {
  constructor(private readonly http: HttpService) {}

  async lnurlpForward(id: string): Promise<LnurlPayRequestDto> {
    const lnBitsUrl = `${LightningHelper.lnurlpLnBitsBasePath}/${id}`;
    const payRequest = await this.http.get<LnurlPayRequestDto>(lnBitsUrl);

    payRequest.callback = `${LightningHelper.lnurlpCallbackDfxApiBasePath}/${id}`;
    payRequest.metadata = '[["text/plain", "DFX Deposit Address"]]';

    return payRequest;
  }

  async lnurlpCallbackForward(id: string, params: any): Promise<LnurlPayCallbackDto> {
    const lnBitsCallbackUrl = `${LightningHelper.lnurlpCallbackLnBitsBasePath}/${id}`;
    return this.http.get<LnurlPayCallbackDto>(lnBitsCallbackUrl, { params });
  }
}
