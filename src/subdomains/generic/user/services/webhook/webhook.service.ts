import { Injectable } from '@nestjs/common';
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

@Injectable()
export class WebhookService {
  constructor(
    private readonly webhookRepo: WebhookRepository,
    private readonly userRepo: UserRepository,
    private readonly webhookNotificationService: WebhookNotificationService,
    private readonly walletService: WalletService,
  ) {}

  async kycChanged(userData: UserData): Promise<void> {
    userData.users ??= await this.userRepo.find({
      where: { userData: { id: userData.id } },
      relations: { wallet: true },
    });

    const webhookData: CreateWebhookInput = {
      data: JSON.stringify(WebhookDataMapper.mapKycData(userData)),
      type: WebhookType.KYC_CHANGED,
      userData,
      wallet: null,
    };

    for (const user of userData.users) {
      if (!user.wallet) continue;
      await this.createAndSendWebhook({ ...webhookData, user, wallet: user.wallet });
    }

    await this.createAndSendKycClientWebhook(webhookData);
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    userData.users ??= await this.userRepo.find({
      where: { userData: { id: userData.id } },
      relations: { wallet: true },
    });

    const webhookData: CreateWebhookInput = {
      data: JSON.stringify(WebhookDataMapper.mapKycData(userData)),
      reason,
      type: WebhookType.KYC_FAILED,
      userData,
      wallet: null,
    };

    for (const user of userData.users) {
      if (!user.wallet) continue;
      await this.createAndSendWebhook({ ...webhookData, user, wallet: user.wallet });
    }

    await this.createAndSendKycClientWebhook(webhookData);
  }

  async fiatCryptoUpdate(user: User, payment: BuyCryptoExtended): Promise<void> {
    const webhookData: CreateWebhookInput = {
      user,
      data: JSON.stringify(WebhookDataMapper.mapFiatCryptoData(payment)),
      type: WebhookType.PAYMENT,
      userData: user.userData,
      wallet: user.wallet,
    };

    await this.createAndSendWebhook(webhookData);
    await this.createAndSendKycClientWebhook(webhookData);
  }

  async cryptoCryptoUpdate(user: User, payment: BuyCryptoExtended): Promise<void> {
    const webhookData: CreateWebhookInput = {
      user,
      data: JSON.stringify(WebhookDataMapper.mapCryptoCryptoData(payment)),
      type: WebhookType.PAYMENT,
      userData: user.userData,
      wallet: user.wallet,
    };

    await this.createAndSendWebhook(webhookData);
    await this.createAndSendKycClientWebhook(webhookData);
  }

  async cryptoFiatUpdate(user: User, payment: BuyFiatExtended): Promise<void> {
    const webhookData: CreateWebhookInput = {
      user,
      data: JSON.stringify(WebhookDataMapper.mapCryptoFiatData(payment)),
      type: WebhookType.PAYMENT,
      userData: user.userData,
      wallet: user.wallet,
    };

    await this.createAndSendWebhook(webhookData);
    await this.createAndSendKycClientWebhook(webhookData);
  }

  async fiatFiatUpdate(user: User, payment: BuyFiatExtended): Promise<void> {
    const webhookData: CreateWebhookInput = {
      user,
      data: JSON.stringify(WebhookDataMapper.mapFiatFiatData(payment)),
      type: WebhookType.PAYMENT,
      userData: user.userData,
      wallet: user.wallet,
    };

    await this.createAndSendWebhook(webhookData);
    await this.createAndSendKycClientWebhook(webhookData);
  }

  async accountMerge(master: UserData, slave: UserData): Promise<void> {
    await this.createAndSendKycClientWebhook({
      data: JSON.stringify(WebhookDataMapper.mapAccountMergeData(master, slave)),
      type: WebhookType.ACCOUNT_MERGE,
      userData: master,
      wallet: null,
    });
  }

  // --- HELPER METHODS --- //

  private async createAndSendKycClientWebhook(dto: CreateWebhookInput) {
    for (const walletId of dto.userData.kycClientList) {
      const wallet = await this.walletService.getByIdOrName(walletId);
      if (!wallet) continue;

      await this.createAndSendWebhook({ ...dto, wallet }, true);
    }
  }

  private async createAndSendWebhook(dto: CreateWebhookInput, consented = false): Promise<Webhook | undefined> {
    if (dto.user && !dto.user.wallet)
      dto.wallet = await this.userRepo
        .findOne({ where: { id: dto.user.id }, relations: { wallet: true } })
        .then((u) => u.wallet);
    if (!dto.wallet?.apiUrl || !dto.wallet.isValidForWebhook(dto.type, consented)) return;

    const existing = await this.webhookRepo.findOne({
      where: {
        data: dto.data,
        type: dto.type,
        reason: dto.reason,
        userData: { id: dto.userData.id },
        wallet: { id: dto.wallet.id },
      },
      relations: { user: true },
    });
    if (existing) return;

    const entity = this.webhookRepo.create(dto);

    // try to send the webhook
    const result = await this.webhookNotificationService.triggerWebhook(entity);
    entity.sentWebhook(result);

    return this.webhookRepo.save(entity);
  }
}
