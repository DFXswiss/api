import { Injectable } from '@nestjs/common';
import {
  AddressActivityResponse,
  AddressActivityWebhook,
  Alchemy,
  GetAllWebhooksResponse,
  Network,
  WebhookType,
} from 'alchemy-sdk';
import { Observable, Subject, filter } from 'rxjs';
import { Config, GetConfig } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { AlchemyNetworkMapper } from '../alchemy-network-mapper';
import { CreateWebhookDto } from '../dto/alchemy-create-webhook.dto';
import { AlchemyWebhookDto } from '../dto/alchemy-webhook.dto';

@Injectable()
export class AlchemyWebhookService {
  private readonly alchemy: Alchemy;

  private readonly addressWebhookSubject: Subject<AlchemyWebhookDto>;

  constructor() {
    const config = GetConfig();

    const settings = {
      apiKey: config.alchemy.apiKey,
      authToken: config.alchemy.authToken,
    };

    this.alchemy = new Alchemy(settings);

    this.addressWebhookSubject = new Subject<AlchemyWebhookDto>();
  }

  async getAllWebhooks(): Promise<GetAllWebhooksResponse> {
    return this.alchemy.notify.getAllWebhooks();
  }

  async getWebhookAddresses(webhookId: string): Promise<AddressActivityResponse> {
    return this.alchemy.notify.getAddresses(webhookId);
  }

  async createAddressWebhook(dto: CreateWebhookDto): Promise<AddressActivityWebhook[]> {
    const network = AlchemyNetworkMapper.toAlchemyNetworkByBlockchain(dto.blockchain);
    if (!network) return;

    const allWebhooks = await this.alchemy.notify.getAllWebhooks();

    const url = `${Config.url()}/alchemy/addressWebhook`;

    await Promise.all(
      allWebhooks.webhooks
        .filter((wh) => wh.network === network && wh.url === url)
        .map((wh) => this.alchemy.notify.deleteWebhook(wh.id)),
    );

    const allWebhookAddresses = dto.addresses.map((a) => a.toLowerCase());

    return (
      await Util.doInBatches(
        allWebhookAddresses,
        async (batch: string[]) => this.doCreateAddressWebhook(network, url, batch),
        50000,
      )
    ).flat();
  }

  private async doCreateAddressWebhook(
    network: Network,
    url: string,
    addresses: string[],
  ): Promise<AddressActivityWebhook> {
    const createWebhookAddresses = addresses.splice(0, 1000);

    const addressActivityWebhook = await this.alchemy.notify.createWebhook(url, WebhookType.ADDRESS_ACTIVITY, {
      addresses: createWebhookAddresses,
      network: network,
    });

    await this.doUpdateWebhook(addressActivityWebhook.id, addresses);

    return addressActivityWebhook;
  }

  private async doUpdateWebhook(webhookId: string, addresses: string[]): Promise<void> {
    await Util.doInBatches(
      addresses,
      async (batch: string[]) =>
        this.alchemy.notify.updateWebhook(webhookId, {
          addAddresses: batch,
        }),
      1000,
    );
  }

  getAddressWebhookObservable(network: Network): Observable<AlchemyWebhookDto> {
    return this.addressWebhookSubject.asObservable().pipe(filter((data) => network === Network[data.event.network]));
  }

  processAddressWebhook(dto: AlchemyWebhookDto): void {
    this.addressWebhookSubject.next(dto);
  }
}
