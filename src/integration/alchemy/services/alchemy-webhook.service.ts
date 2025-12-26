import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  AddressActivityResponse,
  AddressActivityWebhook,
  Alchemy,
  GetAddressesOptions,
  Network,
  Webhook,
  WebhookType,
} from 'alchemy-sdk';
import { Observable, Subject, filter } from 'rxjs';
import { Config, GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { AlchemyNetworkMapper } from '../alchemy-network-mapper';
import { CreateWebhookDto } from '../dto/alchemy-create-webhook.dto';
import { AlchemyWebhookDto } from '../dto/alchemy-webhook.dto';

@Injectable()
export class AlchemyWebhookService implements OnModuleInit {
  private readonly logger = new DfxLogger(AlchemyWebhookService);

  private readonly alchemy: Alchemy;
  private webhookCache: Map<string, string>;

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

  onModuleInit() {
    const config = GetConfig();

    // Skip webhook initialization in local development mode
    if (config.environment === 'loc') {
      this.logger.verbose('Skipping Alchemy webhook initialization in local development mode');
      this.webhookCache = new Map();
      return;
    }

    // Skip if credentials are not configured
    if (!config.alchemy.apiKey || !config.alchemy.authToken) {
      this.logger.warn('Alchemy credentials not configured, skipping webhook initialization');
      this.webhookCache = new Map();
      return;
    }

    void this.getAllWebhooks().then((l) => (this.webhookCache = new Map(l.map((w) => [w.id, w.signingKey]))));
  }

  async getAllWebhooks(): Promise<Webhook[]> {
    return this.alchemy.notify.getAllWebhooks().then((r) => r.webhooks);
  }

  async getWebhookAddresses(webhookId: string, options?: GetAddressesOptions): Promise<AddressActivityResponse> {
    return this.alchemy.notify.getAddresses(webhookId, options);
  }

  isValidWebhookSignature(alchemySignature: string, webhookId: string, rawBody: any): boolean {
    const signingKey = this.webhookCache.get(webhookId);
    if (!signingKey) {
      this.logger.warn(`Webhook Id ${webhookId} has no signing key`);
      this.logger.warn(`Webhook cache: ${JSON.stringify(this.webhookCache)}`);
      return false;
    }

    const checkSignature = Util.createHmac(signingKey, rawBody);
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
        async (batch: string[]) =>
          this.doCreateAddressWebhook(
            `DFX ${Config.environment.toUpperCase()} (${dto.blockchain})`,
            network,
            url,
            batch,
          ),
        50000,
      )
    ).flat();
  }

  private async doCreateAddressWebhook(
    name: string,
    network: Network,
    url: string,
    addresses: string[],
  ): Promise<AddressActivityWebhook> {
    const createWebhookAddresses = addresses.splice(0, 500);

    const addressActivityWebhook = await this.alchemy.notify.createWebhook(url, WebhookType.ADDRESS_ACTIVITY, {
      addresses: createWebhookAddresses,
      network: network,
      name: name,
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
      500,
    );
  }

  getAddressWebhookObservable(network: Network): Observable<AlchemyWebhookDto> {
    return this.addressWebhookSubject.asObservable().pipe(filter((data) => network === Network[data.event.network]));
  }

  processAddressWebhook(dto: AlchemyWebhookDto): void {
    this.addressWebhookSubject.next(dto);
  }
}
