import { Injectable, OnModuleInit } from '@nestjs/common';
import { Network as TatumNetwork, TatumSDK, Solana as TatumSolana } from '@tatumio/tatum';
import { Observable, Subject } from 'rxjs';
import { Config, Environment } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { CreateTatumWebhookDto, TatumWebhookDto } from '../dto/tatum.dto';
import { TatumNetworkMapper } from '../tatum-network-mapper';

@Injectable()
export class TatumWebhookService implements OnModuleInit {
  private readonly addressWebhookSubject: Subject<TatumWebhookDto>;

  private tatum: TatumSolana;

  constructor() {
    this.addressWebhookSubject = new Subject<TatumWebhookDto>();
  }

  async onModuleInit() {
    this.tatum = await TatumSDK.init<TatumSolana>({
      network: TatumNetwork.SOLANA,
      apiKey: Config.blockchain.solana.solanaApiKey,
    });
  }

  isValidWebhookSignature(tatumSignature: string, rawBody: any): boolean {
    const checkSignature = Util.createHmac(Config.tatum.hmacKey, rawBody, 'sha512', 'base64');
    return tatumSignature === checkSignature;
  }

  async createAddressWebhook(dto: CreateTatumWebhookDto): Promise<string[]> {
    const network = TatumNetworkMapper.toTatumNetworkByBlockchain(dto.blockchain);
    if (!network) return;

    const url = `${Config.url()}/tatum/addressWebhook`;

    // Max. 5 allowed in Testaccount ...
    const createWebhookAddresses = Config.environment === Environment.PRD ? dto.addresses : dto.addresses.splice(0, 5);

    const allSubscriptionIds = (
      await Util.doInBatches(
        createWebhookAddresses,
        async (batch: string[]) => this.doCreateAddressWebhook(url, batch),
        100,
      )
    ).flat();

    return allSubscriptionIds;
  }

  private async doCreateAddressWebhook(url: string, addresses: string[]): Promise<string[]> {
    return Promise.all(
      addresses.map((address) =>
        this.tatum.notification.subscribe.addressEvent({
          address: address,
          url: url,
        }),
      ),
    ).then((s) => s.map((s) => s.data.id));
  }

  getAddressWebhookObservable(): Observable<TatumWebhookDto> {
    return this.addressWebhookSubject.asObservable();
  }

  processAddressWebhook(dto: TatumWebhookDto): void {
    this.addressWebhookSubject.next(dto);
  }
}
