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

  // TODO: remove?
  @Column({ default: false })
  isKycClient: boolean;

  // TODO: remove?
  @Column({ default: false })
  usesDummyAddresses: boolean;

  // TODO: remove
  @Column({ nullable: true })
  customKyc?: KycType;

  // TODO: remove
  @Column({ length: 256, nullable: true })
  identMethod?: KycStepType;

  // TODO: remove
  @Column({ length: 256, nullable: true })
  apiUrl?: string;

  // TODO: remove
  @Column({ length: 256, nullable: true })
  apiKey?: string;

  // TODO: remove
  @Column({ default: AmlRule.DEFAULT })
  amlRule: AmlRule;

  // TODO: remove
  @Column({ length: 'MAX', nullable: true })
  webhookConfig?: string; // JSON string

  @OneToMany(() => User, (user) => user.wallet)
  users: User[];

  // TODO: remove
  get webhookConfigObject(): WebhookConfig | undefined {
    return this.webhookConfig ? (JSON.parse(this.webhookConfig) as WebhookConfig) : undefined;
  }

  // TODO: remove
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

  // TODO: remove
  private isOptionValid(option: WebhookConfigOption | undefined, consented: boolean): boolean {
    return (
      option === WebhookConfigOption.TRUE ||
      (option === WebhookConfigOption.CONSENT_ONLY && consented) ||
      (option === WebhookConfigOption.WALLET_ONLY && !consented)
    );
  }
}
