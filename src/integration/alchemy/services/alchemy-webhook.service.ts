import { Injectable, OnModuleInit } from '@nestjs/common';
import { AddressActivityResponse, AddressActivityWebhook, Alchemy, Network, Webhook, WebhookType } from 'alchemy-sdk';
import { Observable, Subject, filter } from 'rxjs';
import { Config, GetConfig } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { AlchemyNetworkMapper } from '../alchemy-network-mapper';
import { CreateWebhookDto } from '../dto/alchemy-create-webhook.dto';
import { AlchemyWebhookDto } from '../dto/alchemy-webhook.dto';

@Injectable()
export class AlchemyWebhookService implements OnModuleInit {
  private readonly alchemy: Alchemy;
  private readonly webhookCache: Map<string, string>;

  private readonly addressWebhookSubject: Subject<AlchemyWebhookDto>;

  constructor() {
    const config = GetConfig();

    const settings = {
      apiKey: config.alchemy.apiKey,
      authToken: config.alchemy.authToken,
    };

    this.alchemy = new Alchemy(settings);
    this.webhookCache = new Map();

    this.addressWebhookSubject = new Subject<AlchemyWebhookDto>();
  }

  async onModuleInit() {
    const allWebhooks = await this.getAllWebhooks();
    allWebhooks.forEach((w) => this.webhookCache.set(w.id, w.signingKey));
  }

  async getAllWebhooks(): Promise<Webhook[]> {
    return this.alchemy.notify.getAllWebhooks().then((r) => r.webhooks);
  }

  async getWebhookAddresses(webhookId: string): Promise<AddressActivityResponse> {
    return this.alchemy.notify.getAddresses(webhookId);
  }

  isValidWebhookSignature(alchemySignature: string, dto: AlchemyWebhookDto): boolean {
    const signingKey = this.webhookCache.get(dto.webhookId);
    if (!signingKey) return false;

    const checkSignature = Util.createHmac(signingKey, JSON.stringify(dto));
    return alchemySignature === checkSignature;
  }

  async createAddressWebhook(dto: CreateWebhookDto): Promise<AddressActivityWebhook[]> {
    const network = AlchemyNetworkMapper.toAlchemyNetworkByBlockchain(dto.blockchain);
    if (!network) return;

    const url = `${Config.url()}/alchemy/addressWebhook`;

    const allWebhooks = await this.getAllWebhooks();
    const filteredWebhooks = allWebhooks.filter((wh) => wh.network === network && wh.url === url);

    for (const webhookToBeDeleted of filteredWebhooks) {
      const webhookId = webhookToBeDeleted.id;
      this.webhookCache.delete(webhookId);
      await this.alchemy.notify.deleteWebhook(webhookId);
    }

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

    this.webhookCache.set(addressActivityWebhook.id, addressActivityWebhook.signingKey);

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
