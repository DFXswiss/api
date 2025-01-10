import { IEntity } from 'src/shared/models/entity';
import { AmlRule } from 'src/subdomains/core/aml/enums/aml-rule.enum';
import { KycStepType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { Column, Entity } from 'typeorm';
import { WebhookType } from '../../services/webhook/dto/webhook.dto';
import { KycType } from '../user-data/user-data.entity';
import { WebhookConfig, WebhookConfigOption } from '../wallet/wallet.entity';

@Entity()
export class Integrator extends IEntity {
  @Column({ length: 256, nullable: true })
  name?: string;

  @Column({ nullable: true })
  customKyc?: KycType;

  @Column({ length: 256, nullable: true })
  identMethod?: KycStepType;

  @Column({ length: 256, nullable: true })
  apiUrl?: string;

  @Column({ length: 256, nullable: true })
  apiKey?: string;

  @Column({ length: 'MAX', nullable: true })
  webhookConfig?: string; // JSON string

  // TODO: nullable or default?
  @Column({ nullable: true })
  amlRule: AmlRule;

  // --- ENTITY METHODS --- //

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
