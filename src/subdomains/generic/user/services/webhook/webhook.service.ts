import { Injectable } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoExtended, BuyFiatExtended } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { UserData } from '../../models/user-data/user-data.entity';
import { User } from '../../models/user/user.entity';
import { UserRepository } from '../../models/user/user.repository';
import { WalletService } from '../../models/wallet/wallet.service';
import { CreateWebhookInput } from './dto/create-webhook.dto';
import { WebhookType } from './dto/webhook.dto';
import { WebhookDataMapper } from './mapper/webhook-data.mapper';
import { WebhookNotificationService } from './webhook-notification.service';
import { Webhook } from './webhook.entity';
import { WebhookRepository } from './webhook.repository';

enum WebhookDeliveryMode {
  BEST_EFFORT = 'BestEffort',
  STRICT = 'Strict',
}

@Injectable()
export class WebhookService {
  constructor(
    private readonly webhookRepo: WebhookRepository,
    private readonly userRepo: UserRepository,
    private readonly webhookNotificationService: WebhookNotificationService,
    private readonly walletService: WalletService,
  ) {}

  // --- KYC WEBHOOKS --- //
  async kycChanged(userData: UserData): Promise<void> {
    return this.sendKycChanged(userData, WebhookDeliveryMode.BEST_EFFORT);
  }

  async kycChangedStrict(userData: UserData): Promise<void> {
    return this.sendKycChanged(userData, WebhookDeliveryMode.STRICT);
  }

  private async sendKycChanged(userData: UserData, deliveryMode: WebhookDeliveryMode): Promise<void> {
    const payload = WebhookDataMapper.mapKycData(userData);
    const users = await this.getUsers(userData);

    await this.sendWebhooks(WebhookType.KYC_CHANGED, payload, userData, users, deliveryMode);
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    const payload = WebhookDataMapper.mapKycData(userData);
    const users = await this.getUsers(userData);

    await this.sendWebhooks(WebhookType.KYC_FAILED, payload, userData, users, WebhookDeliveryMode.BEST_EFFORT, reason);
  }

  async accountChanged(master: UserData, slave: UserData): Promise<void> {
    return this.sendAccountChanged(master, slave, WebhookDeliveryMode.BEST_EFFORT);
  }

  async accountChangedStrict(master: UserData, slave: UserData): Promise<void> {
    return this.sendAccountChanged(master, slave, WebhookDeliveryMode.STRICT);
  }

  private async sendAccountChanged(
    master: UserData,
    slave: UserData,
    deliveryMode: WebhookDeliveryMode,
  ): Promise<void> {
    const payload = WebhookDataMapper.mapAccountMergeData(master);

    await this.sendWebhooks(WebhookType.ACCOUNT_CHANGED, payload, slave, [], deliveryMode);
  }

  // --- PAYMENT WEBHOOKS --- //
  async fiatCryptoUpdate(user: User, userData: UserData, payment: BuyCryptoExtended): Promise<void> {
    const payload = WebhookDataMapper.mapFiatCryptoData(payment);

    await this.sendWebhooks(WebhookType.PAYMENT, payload, userData, [user], WebhookDeliveryMode.BEST_EFFORT);
  }

  async cryptoCryptoUpdate(user: User, userData: UserData, payment: BuyCryptoExtended): Promise<void> {
    const payload = WebhookDataMapper.mapCryptoCryptoData(payment);

    await this.sendWebhooks(WebhookType.PAYMENT, payload, userData, [user], WebhookDeliveryMode.BEST_EFFORT);
  }

  async cryptoFiatUpdate(user: User, userData: UserData, payment: BuyFiatExtended): Promise<void> {
    const payload = WebhookDataMapper.mapCryptoFiatData(payment);

    await this.sendWebhooks(WebhookType.PAYMENT, payload, userData, [user], WebhookDeliveryMode.BEST_EFFORT);
  }

  async fiatFiatUpdate(user: User, userData: UserData, payment: BuyFiatExtended): Promise<void> {
    const payload = WebhookDataMapper.mapFiatFiatData(payment);

    await this.sendWebhooks(WebhookType.PAYMENT, payload, userData, [user], WebhookDeliveryMode.BEST_EFFORT);
  }

  // --- HELPER METHODS --- //
  private async sendWebhooks(
    type: WebhookType,
    payload: object,
    userData: UserData,
    users: User[],
    deliveryMode: WebhookDeliveryMode,
    reason?: string,
  ): Promise<void> {
    // load wallets
    for (const user of users) {
      user.wallet ??= await this.userRepo
        .findOne({ where: { id: user.id }, relations: { wallet: true } })
        .then((u) => u.wallet);
    }

    const identifier = Util.createObjectHash(this.removeDates(payload));
    const data = JSON.stringify(payload);

    // user webhooks
    const webhooks: CreateWebhookInput[] = users
      .filter((user) => user.wallet.isValidForWebhook(type, false))
      .map((user) => ({ type, identifier, data, reason, userData, user, wallet: user.wallet }));

    // user data webhooks
    const additionalClients = userData.kycClientList.filter((w) => !webhooks.some(({ wallet }) => wallet.id === w));
    for (const walletId of additionalClients) {
      const wallet = await this.walletService.getByIdOrName(walletId);
      if (wallet?.isValidForWebhook(type, true)) webhooks.push({ type, identifier, data, reason, userData, wallet });
    }

    for (const client of webhooks) {
      await this.createAndSendWebhook(client, deliveryMode);
    }
  }

  private async createAndSendWebhook(
    dto: CreateWebhookInput,
    deliveryMode: WebhookDeliveryMode,
  ): Promise<Webhook | undefined> {
    const identity = {
      identifier: dto.identifier,
      type: dto.type,
      reason: dto.reason,
      userData: { id: dto.userData.id },
      wallet: { id: dto.wallet.id },
    };

    if (deliveryMode === WebhookDeliveryMode.BEST_EFFORT) {
      if (await this.webhookRepo.existsBy(identity)) return;
    } else {
      const existing = await this.webhookRepo.findOne({ where: identity, order: { id: 'DESC' } });
      if (existing?.isComplete) return existing;
      if (existing) return this.deliverWebhook(existing, deliveryMode);
    }

    // no repo.create: TypeORM's plain-object transformer recurses through the relation graph without a
    // cycle guard and overflows the stack on circular entities (e.g. userData.kycSteps[i].userData === userData)
    const entity = Object.assign(new Webhook(), dto);
    return this.deliverWebhook(entity, deliveryMode);
  }

  private async deliverWebhook(entity: Webhook, deliveryMode: WebhookDeliveryMode): Promise<Webhook> {
    // try to send the webhook
    const result = await this.webhookNotificationService.triggerWebhook(entity);
    if (result && deliveryMode === WebhookDeliveryMode.STRICT) {
      entity.failedWebhookForRetry(result);
      await this.webhookRepo.save(entity);
      throw new Error(
        `Strict webhook delivery failed ` +
          `(userDataId=${entity.userData.id}, walletId=${entity.wallet.id}, type=${entity.type})`,
      );
    }

    entity.sentWebhook(result);
    return this.webhookRepo.save(entity);
  }

  private async getUsers(userData: UserData): Promise<User[]> {
    return (
      userData.users ??
      this.userRepo.find({
        where: { userData: { id: userData.id } },
        relations: { wallet: true },
      })
    );
  }

  private removeDates(obj: object): object {
    return Object.entries(obj)
      .filter(([_, value]) => !(value instanceof Date))
      .reduce((prev, [key, value]) => {
        prev[key] = value;
        return prev;
      }, {});
  }
}
