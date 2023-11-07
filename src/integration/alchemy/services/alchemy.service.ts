import { Injectable } from '@nestjs/common';
import {
  AddressActivityResponse,
  AddressActivityWebhook,
  Alchemy,
  GetAllWebhooksResponse,
  WebhookType,
} from 'alchemy-sdk';
import { Observable, Subject } from 'rxjs';
import { GetConfig } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { AlchemyNetworkMapper } from '../alchemy-network-mapper';
import { CreateWebhookDto } from '../dto/alchemy-create-webhook.dto';

@Injectable()
export class AlchemyService {
  private alchemy: Alchemy;

  private addressWebhookSubject: Subject<any>;

  constructor() {
    const config = GetConfig();

    const settings = {
      apiKey: config.alchemy.apiKey,
      authToken: config.alchemy.authToken,
    };

    this.alchemy = new Alchemy(settings);

    this.addressWebhookSubject = new Subject<any>();
  }

  async getAllWebhooks(): Promise<GetAllWebhooksResponse> {
    return this.alchemy.notify.getAllWebhooks();
  }

  async getWebhookAddresses(webhookId: string): Promise<AddressActivityResponse> {
    return this.alchemy.notify.getAddresses(webhookId);
  }

  async createAddressWebhook(dto: CreateWebhookDto): Promise<AddressActivityWebhook[]> {
    const network = AlchemyNetworkMapper.toAlchemyNetwork(dto.blockchain);
    if (!network) return;

    const allWebhooks = await this.alchemy.notify.getAllWebhooks();
    await Promise.all(
      allWebhooks.webhooks.filter((wh) => wh.network === network).map((wh) => this.alchemy.notify.deleteWebhook(wh.id)),
    );

    //const url = `${Config.url}/alchemy/addressWebhook`;
    const url = 'https://dev.api.dfx.swiss/v1/alchemy/addressWebhook';

    return (
      await Util.doInBatches(
        dto.addresses,
        async (batch: string[]) =>
          this.alchemy.notify.createWebhook(url, WebhookType.ADDRESS_ACTIVITY, {
            addresses: batch,
            network: network,
          }),
        50000,
      )
    ).flat();
  }

  getAddressWebhookObservable(): Observable<any> {
    return this.addressWebhookSubject.asObservable();
  }

  processAddressWebhook(webhookData: any): void {
    this.addressWebhookSubject.next(webhookData);
  }
}
