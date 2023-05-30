import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { LnurlPayRequestDto } from './dto/lnurlp-payrequest.dto';
import { LightningHelper } from './lightning-helper';

@Injectable()
export class LnUrlForwardService {
  constructor(private readonly http: HttpService) {}

  async lnurlpForward(id: string): Promise<LnurlPayRequestDto> {
    const lnbitsUrl = `${LightningHelper.lnurlpLnBitsBasePath}/${id}`;
    const payRequest = await this.http.get<LnurlPayRequestDto>(lnbitsUrl);

    payRequest.callback = `${LightningHelper.lnurlpCallbackDfxApiBasePath}/${id}`;
    payRequest.metadata = '[["text/plain", "DFX Deposit Address"]]';

    return payRequest;
  }

  async lnurlpCallbackForward(id: string, amount: number): Promise<any> {
    const lnbitsCallbackUrl = `${LightningHelper.lnurlpCallbackLnBitsBasePath}/${id}?amount=${amount}`;
    return this.http.get<any>(lnbitsCallbackUrl);
  }
}
