import { Injectable } from '@nestjs/common';
import { Network as TatumNetwork, TatumSDK, Solana as TatumSolana, Tron as TatumTron } from '@tatumio/tatum';
import { Observable, Subject } from 'rxjs';
import { Config, Environment } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { CreateTatumWebhookDto, TatumWebhookDto } from '../dto/tatum.dto';
import { TatumNetworkMapper } from '../tatum-network-mapper';

type TatumSdk = TatumSolana | TatumTron;

@Injectable()
export class TatumWebhookService {
  private readonly addressWebhookSubject: Subject<TatumWebhookDto>;

  private readonly tatumMap = new Map<TatumNetwork, TatumSdk>();

  constructor() {
    this.addressWebhookSubject = new Subject<TatumWebhookDto>();
  }

  isValidWebhookSignature(tatumSignature: string, rawBody: any): boolean {
    const checkSignature = Util.createHmac(Config.tatum.hmacKey, rawBody, 'sha512', 'base64');
    return tatumSignature === checkSignature;
  }

  async createAddressWebhook(dto: CreateTatumWebhookDto): Promise<string[]> {
    const network = TatumNetworkMapper.toTatumNetworkByBlockchain(dto.blockchain);
    if (!network) return;

    const tatumSdk = await this.getTatumSdk(network);

    const url = `${Config.url()}/tatum/addressWebhook`;

    // Max. 5 allowed in Testaccount ...
    const createWebhookAddresses = Config.environment === Environment.PRD ? dto.addresses : dto.addresses.splice(0, 5);

    const allSubscriptionIds = (
      await Util.doInBatches(
        createWebhookAddresses,
        async (batch: string[]) => this.doCreateAddressWebhook(tatumSdk, url, batch),
        100,
      )
    ).flat();

    return allSubscriptionIds;
  }

  private async doCreateAddressWebhook(tatumSdk: TatumSdk, url: string, addresses: string[]): Promise<string[]> {
    return Promise.all(
      addresses.map((address) =>
        tatumSdk.notification.subscribe.addressEvent({
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

  // --- Tatum Setup --- //

  private async getTatumSdk(tatumNetwork: TatumNetwork): Promise<TatumSdk> {
    const tatum = this.tatumMap.get(tatumNetwork);
    return tatum ?? this.setupTatumSdk(tatumNetwork);
  }

  private async setupTatumSdk(tatumNetwork: TatumNetwork): Promise<TatumSdk> {
    let tatumSdk: TatumSdk;

    if (tatumNetwork === TatumNetwork.SOLANA) {
      tatumSdk = await TatumSDK.init<TatumSolana>({
        network: tatumNetwork,
        apiKey: Config.tatum.apiKey,
      });
    }

    if (tatumNetwork === TatumNetwork.TRON) {
      tatumSdk = await TatumSDK.init<TatumTron>({
        network: tatumNetwork,
        apiKey: Config.tatum.apiKey,
      });
    }

    if (tatumSdk) {
      this.tatumMap.set(tatumNetwork, tatumSdk);
      return tatumSdk;
    }

    throw new Error(`Invalid tatum network ${tatumNetwork}`);
  }
}
