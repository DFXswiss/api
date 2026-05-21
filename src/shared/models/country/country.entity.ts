import { AmlRule } from 'src/subdomains/core/aml/enums/aml-rule.enum';
import { IdentDocumentType } from 'src/subdomains/generic/kyc/dto/ident-result-data.dto';
import { KycType } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { Column, Entity } from 'typeorm';
import { IEntity } from '../entity';

@Entity()
export class Country extends IEntity {
  @Column({ unique: true, length: 10 })
  symbol: string;

  @Column({ unique: true, length: 10 })
  symbol3: string;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 256, nullable: true })
  foreignName: string;

  @Column({ default: true })
  dfxEnable: boolean;

  @Column({ default: false })
  dfxOrganizationEnable: boolean;

  @Column({ default: true })
  lockEnable: boolean;

  @Column({ default: true })
  ipEnable: boolean;

  @Column({ default: false })
  yapealEnable: boolean;

  @Column({ default: true })
  fatfEnable: boolean;

  @Column({ default: true })
  nationalityEnable: boolean;

  @Column({ default: true })
  nationalityStepEnable: boolean;

  @Column({ default: false })
  bankTransactionVerificationEnable: boolean;

  @Column({ default: true })
  bankEnable: boolean;

  @Column({ default: true })
  cryptoEnable: boolean;

  @Column({ default: true })
  checkoutEnable: boolean;

  @Column({ default: AmlRule.DEFAULT })
  amlRule: AmlRule;

  @Column({ default: false })
  manualReviewRequired: boolean;

  @Column({ default: false })
  manualReviewRequiredOrganization: boolean;

  // Lower number = higher in country pickers. Default 999 keeps everything
  // sorted alphabetically as before unless an admin promotes a country.
  // The realunit-app's hardcoded priorityCountries (`['CH','DE','IT','FR']`)
  // is seeded as 1..4 by the W4.3 migration.
  @Column({ default: 999 })
  displayOrder: number;

  @Column({ type: 'text', nullable: true })
  enabledKycDocuments: string; // semicolon separated KycDocuments

  get enabledKycDocumentList(): IdentDocumentType[] {
    return (this.enabledKycDocuments?.split(';') ?? []) as IdentDocumentType[];
  }

  isKycDocEnabled(kycDoc: IdentDocumentType): boolean {
    return this.enabledKycDocumentList.includes(kycDoc);
  }

  isEnabled(kycType: KycType): boolean {
    switch (kycType) {
      case KycType.DFX:
        return this.dfxEnable;

      case KycType.LOCK:
        return this.lockEnable;
    }
  }
}
