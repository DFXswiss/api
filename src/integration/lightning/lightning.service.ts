import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { LightningClient } from './lightning-client';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LightningHelper } from './lightning-helper';
import { LnurlPayRequestDto } from './dto/lnurlp-pay-request.dto';
import { LnurlPayCallbackDto } from './dto/lnurlp-pay-callback.dto';

@Injectable()
export class LightningService {
  private readonly logger = new DfxLogger(LightningService);

  private readonly client: LightningClient;

  constructor(private readonly http: HttpService) {
    this.client = new LightningClient(http);
  }

  getDefaultClient(): LightningClient {
    return this.client;
  }

  verifySignature(message: string, signature: string, publicKey: string): boolean {
    return LightningHelper.verifySignature(message, signature, publicKey);
  }

  async getPublicKeyOfLnurlp(lnurlp: string): Promise<string> {
    try {
      const url = LightningHelper.decodeLnurlp(lnurlp);

      const payRequest = await this.http.get<LnurlPayRequestDto>(url);

      const { pr: invoice } = await this.http.get<LnurlPayCallbackDto>(payRequest.callback, {
        params: { amount: payRequest.minSendable },
      });

      return LightningHelper.getPublicKeyOfInvoice(invoice);
    } catch {
      throw new BadRequestException('Invalid LNURLp');
    }
  }
}
