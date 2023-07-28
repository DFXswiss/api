import { Injectable } from '@nestjs/common';
import { LnurlPayRequestDto, LnurlpInvoiceDto } from '../dto/lnurlp.dto';
import { LnurlWithdrawRequestDto, LnurlwInvoiceDto } from '../dto/lnurlw.dto';
import { LightningClient } from '../lightning-client';
import { LightningHelper } from '../lightning-helper';
import { LightningService } from './lightning.service';

@Injectable()
export class LnUrlForwardService {
  private readonly client: LightningClient;

  constructor(lightningService: LightningService) {
    this.client = lightningService.getDefaultClient();
  }

  // --- LNURLp --- //
  async lnurlpForward(id: string): Promise<LnurlPayRequestDto> {
    const payRequest = await this.client.getLnurlpPaymentRequest(id);

    payRequest.callback = LightningHelper.createLnurlpCallbackUrl(id);

    return payRequest;
  }

  async lnurlpCallbackForward(id: string, params: any): Promise<LnurlpInvoiceDto> {
    return this.client.getLnurlpInvoice(id, params);
  }

  // --- LNURLw --- //
  async lnurlwForward(id: string): Promise<LnurlWithdrawRequestDto> {
    const withdrawRequest = await this.client.getLnurlwWithdrawRequest(id);

    withdrawRequest.callback = LightningHelper.createLnurlwCallbackUrl(id);

    return withdrawRequest;
  }

  async lnurlwCallbackForward(id: string, params: any): Promise<LnurlwInvoiceDto> {
    return this.client.sendLnurlwInvoice(id, params);
  }
}
