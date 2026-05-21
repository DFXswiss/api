import { Column, Entity, Index } from 'typeorm';
import { IEntity } from '../entity';

export enum LegalDocumentType {
  REGISTRATION_AGREEMENT = 'RegistrationAgreement',
  PROSPECTUS = 'Prospectus',
  AKTIONARIAT_TERMS = 'AktionariatTerms',
  AKTIONARIAT_PRIVACY = 'AktionariatPrivacy',
  DFX_TERMS = 'DfxTerms',
  DFX_PRIVACY = 'DfxPrivacy',
}

@Entity()
@Index(['type', 'language'], { unique: true, where: '"enabled" = 1' })
export class LegalDocument extends IEntity {
  @Column({ length: 64 })
  type: LegalDocumentType;

  // ISO 639-1 lowercase two-letter code (`de`, `en`, …). Lowercased to match
  // the `Language.symbol` column on the API which is stored uppercase but
  // consumed case-insensitively. `null` ⇒ language-agnostic document.
  @Column({ length: 8, nullable: true })
  language?: string;

  @Column({ length: 32 })
  version: string;

  @Column({ length: 1024 })
  url: string;

  @Column({ default: true })
  enabled: boolean;
}
