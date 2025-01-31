import { IEntity } from 'src/shared/models/entity';
import { AmlRule } from 'src/subdomains/core/aml/enums/aml-rule.enum';
import { KycStepType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index, OneToMany } from 'typeorm';
import { WebhookType } from '../../services/webhook/dto/webhook.dto';
import { KycType } from '../user-data/user-data.entity';

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
  address?: string;

  @Column({ length: 256, nullable: true })
  name?: string;

  @Column({ length: 256, nullable: true })
  displayName?: string;

  @Column({ default: false })
  isKycClient: boolean;

  @Column({ default: false })
  displayFraudWarning: boolean;

  @Column({ default: false })
  usesDummyAddresses: boolean;

  @Column({ nullable: true })
  customKyc?: KycType;

  @OneToMany(() => User, (user) => user.wallet)
  users: User[];

  @Column({ length: 256, nullable: true })
  identMethod?: KycStepType;

  @Column({ length: 256, nullable: true })
  apiUrl?: string;

  @Column({ length: 256, nullable: true })
  apiKey?: string;

  @Column({ default: AmlRule.DEFAULT })
  amlRule: AmlRule;

  @Column({ length: 'MAX', nullable: true })
  webhookConfig?: string; // JSON string

  get webhookConfigObject(): WebhookConfig | undefined {
    return this.webhookConfig ? (JSON.parse(this.webhookConfig) as WebhookConfig) : undefined;
  }

  isValidForWebhook(type: WebhookType, consented: boolean): boolean {
    if (!this.apiUrl) return false;

    switch (type) {
      case WebhookType.KYC_CHANGED:
      case WebhookType.KYC_FAILED:
      case WebhookType.ACCOUNT_CHANGED:
        return this.isOptionValid(this.webhookConfigObject?.kyc, consented);

      case WebhookType.PAYMENT:
        return this.isOptionValid(this.webhookConfigObject?.payment, consented);
    }
  }

  private isOptionValid(option: WebhookConfigOption | undefined, consented: boolean): boolean {
    return (
      option === WebhookConfigOption.TRUE ||
      (option === WebhookConfigOption.CONSENT_ONLY && consented) ||
      (option === WebhookConfigOption.WALLET_ONLY && !consented)
    );
  }
}
