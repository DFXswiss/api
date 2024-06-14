import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoExtended, BuyFiatExtended } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { IsNull } from 'typeorm';
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

@Injectable()
export class WebhookService {
  private readonly logger = new DfxLogger(WebhookService);

  constructor(
    private readonly webhookRepo: WebhookRepository,
    private readonly userRepo: UserRepository,
    private readonly webhookNotificationService: WebhookNotificationService,
    private readonly walletService: WalletService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async syncWebhooks() {
    if (DisabledProcess(Process.SYNCHRONIZE_WEBHOOK)) return;

    const entities = await this.webhookRepo.find({ where: { identifier: IsNull() } });

    for (const entity of entities) {
      try {
        const identifier = Util.createObjectHash(this.removeDates(JSON.parse(entity.data)));
        await this.webhookRepo.update(entity.id, { identifier });
      } catch (e) {
        this.logger.error(`Failed to sync webhook ${entity.id}:`, e);
      }
    }
  }

  // --- KYC WEBHOOKS --- //
  async kycChanged(userData: UserData): Promise<void> {
    const payload = WebhookDataMapper.mapKycData(userData);
    const users = await this.getUsers(userData);

    await this.sendWebhooks(WebhookType.KYC_CHANGED, payload, userData, users);
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    const payload = WebhookDataMapper.mapKycData(userData);
    const users = await this.getUsers(userData);

    await this.sendWebhooks(WebhookType.KYC_FAILED, payload, userData, users, reason);
  }

  async accountChanged(master: UserData, slave: UserData): Promise<void> {
    const payload = WebhookDataMapper.mapAccountMergeData(master);

    await this.sendWebhooks(WebhookType.ACCOUNT_CHANGED, payload, slave, []);
  }

  // --- PAYMENT WEBHOOKS --- //
  async fiatCryptoUpdate(user: User, payment: BuyCryptoExtended): Promise<void> {
    const payload = WebhookDataMapper.mapFiatCryptoData(payment);

    await this.sendWebhooks(WebhookType.PAYMENT, payload, user.userData, [user]);
  }

  async cryptoCryptoUpdate(user: User, payment: BuyCryptoExtended): Promise<void> {
    const payload = WebhookDataMapper.mapCryptoCryptoData(payment);

    await this.sendWebhooks(WebhookType.PAYMENT, payload, user.userData, [user]);
  }

  async cryptoFiatUpdate(user: User, payment: BuyFiatExtended): Promise<void> {
    const payload = WebhookDataMapper.mapCryptoFiatData(payment);

    await this.sendWebhooks(WebhookType.PAYMENT, payload, user.userData, [user]);
  }

  async fiatFiatUpdate(user: User, payment: BuyFiatExtended): Promise<void> {
    const payload = WebhookDataMapper.mapFiatFiatData(payment);

    await this.sendWebhooks(WebhookType.PAYMENT, payload, user.userData, [user]);
  }

  // --- HELPER METHODS --- //
  private async sendWebhooks(
    type: WebhookType,
    payload: object,
    userData: UserData,
    users: User[],
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
      await this.createAndSendWebhook(client);
    }
  }

  private async createAndSendWebhook(dto: CreateWebhookInput): Promise<Webhook | undefined> {
    const exists = await this.webhookRepo.exist({
      where: {
        identifier: dto.identifier,
        type: dto.type,
        reason: dto.reason,
        userData: { id: dto.userData.id },
        wallet: { id: dto.wallet.id },
      },
    });
    if (exists) return;

    const entity = this.webhookRepo.create(dto);

    // try to send the webhook
    const result = await this.webhookNotificationService.triggerWebhook(entity);
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
