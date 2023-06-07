import { BadRequestException, Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { LnurlpInvoiceDto } from '../dto/lnurlp-invoice.dto';
import { LnurlPayRequestDto } from '../dto/lnurlp-pay-request.dto';
import { LightningClient } from '../lightning-client';
import { LightningHelper } from '../lightning-helper';

@Injectable()
export class LightningService {
  private readonly logger = new DfxLogger(LightningService);

  private readonly pubKeyPrefix = 'LNNID';

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

  async getPublicKeyOfAddress(address: string): Promise<string> {
    if (address.startsWith(this.pubKeyPrefix)) {
      // address is node pub key
      return address.replace(this.pubKeyPrefix, '');
    }

    try {
      // address is LNURLp
      const url = LightningHelper.decodeLnurlp(address);

      const payRequest = await this.http.get<LnurlPayRequestDto>(url);

      const { pr: invoice } = await this.http.get<LnurlpInvoiceDto>(payRequest.callback, {
        params: { amount: payRequest.minSendable },
      });

      return LightningHelper.getPublicKeyOfInvoice(invoice);
    } catch {
      throw new BadRequestException('Invalid LNURLp');
    }
  }
}
