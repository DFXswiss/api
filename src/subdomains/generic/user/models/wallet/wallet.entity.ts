import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index, OneToMany } from 'typeorm';
import { WebhookType } from '../../services/webhook/dto/webhook.dto';
import { KycStatus, KycType } from '../user-data/user-data.entity';

export enum AmlRule {
  DEFAULT = 0, // default
  RULE_1 = 1, // IP Check
  RULE_2 = 2, // KycLevel 30
  RULE_3 = 3, // KycLevel 50
  RULE_4 = 4, // UserData maxWeeklyVolume
}

export interface WebhookConfig {
  payment: WebhookConfigOption;
  kyc: WebhookConfigOption;
}

export enum WebhookConfigOption {
  TRUE = 'True',
  FALSE = 'False',
  CONSENT_ONLY = 'ConsentOnly',
  WALLET_ONLY = 'WalletOnly',
}

@Entity()
export class Wallet extends IEntity {
  @Column({ length: 256, nullable: true })
  @Index({ unique: true, where: 'address IS NOT NULL' })
  address: string;

  @Column({ length: 256, nullable: true })
  name: string;

  @Column({ length: 256, nullable: true })
  masterKey: string;

  @Column({ default: false })
  isKycClient: boolean;

  @Column({ nullable: true })
  customKyc: KycType;

  @OneToMany(() => User, (user) => user.wallet)
  users: User[];

  @Column({ length: 256, nullable: true })
  identMethod?: KycStatus;

  @Column({ length: 256, nullable: true })
  apiUrl: string;

  @Column({ length: 256, nullable: true })
  apiKey: string;

  @Column({ default: AmlRule.DEFAULT })
  amlRule: AmlRule;

  @Column({ length: 'MAX', nullable: true })
  webhookConfig: string; // JSON string

  get webhookConfigObject(): WebhookConfig | undefined {
    return this.webhookConfig ? (JSON.parse(this.webhookConfig) as WebhookConfig) : undefined;
  }

  isValidForWebhook(type: WebhookType, consented: boolean): boolean {
    if (!this.apiUrl) return false;

    switch (type) {
      case WebhookType.KYC_CHANGED:
      case WebhookType.KYC_FAILED:
        return (
          this.webhookConfigObject?.kyc === WebhookConfigOption.TRUE ||
          (this.webhookConfigObject?.kyc === WebhookConfigOption.CONSENT_ONLY && consented) ||
          (this.webhookConfigObject?.kyc === WebhookConfigOption.WALLET_ONLY && !consented)
        );

      case WebhookType.PAYMENT:
        return (
          this.webhookConfigObject?.payment === WebhookConfigOption.TRUE ||
          (this.webhookConfigObject?.payment === WebhookConfigOption.CONSENT_ONLY && consented) ||
          (this.webhookConfigObject?.payment === WebhookConfigOption.WALLET_ONLY && !consented)
        );
    }
  }
}
