import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { LnUrlPayRequestDto } from './dto/lnurlp-payrequest.dto';
import { LightningHelper } from './lightning-helper';

@Injectable()
export class LnUrlForwardService {
  constructor(private readonly http: HttpService) {}

  async lnUrlPForward(id: string): Promise<LnUrlPayRequestDto> {
    const lnbitsUrl = `${LightningHelper.lnUrlPLnBitsBasePath}/${id}`;
    const payRequest = await this.http.get<LnUrlPayRequestDto>(lnbitsUrl);

    const lnbitsCallbackUrl = `${LightningHelper.lnUrlPCallbackDfxApiBasePath}/${id}`;
    const metadata = '[["text/plain", "DFX Deposit Address"]]';

    payRequest.callback = lnbitsCallbackUrl;
    payRequest.metadata = metadata;

    return payRequest;
  }

  async lnUrlPCallbackForward(id: string, amount: number): Promise<any> {
    const lnbitsCallbackUrl = `${LightningHelper.lnUrlPCallbackLnBitsBasePath}/${id}?amount=${amount}`;
    return this.http.get<any>(lnbitsCallbackUrl);
  }
}
