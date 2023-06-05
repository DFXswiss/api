import { Injectable } from '@nestjs/common';
import { LnurlpInvoiceDto } from '../dto/lnurlp-invoice.dto';
import { LnurlPayRequestDto } from '../dto/lnurlp-pay-request.dto';
import { LightningClient } from '../lightning-client';
import { LightningHelper } from '../lightning-helper';
import { LightningService } from './lightning.service';

@Injectable()
export class LnUrlForwardService {
  private readonly client: LightningClient;

  constructor(lightningService: LightningService) {
    this.client = lightningService.getDefaultClient();
  }

  async lnurlpForward(id: string): Promise<LnurlPayRequestDto> {
    const payRequest = await this.client.getPaymentRequest(id);

    payRequest.callback = LightningHelper.createLnurlpCallbackUrl(id);

    return payRequest;
  }

  async lnurlpCallbackForward(id: string, params: any): Promise<LnurlpInvoiceDto> {
    return this.client.createInvoice(id, params);
  }
}
