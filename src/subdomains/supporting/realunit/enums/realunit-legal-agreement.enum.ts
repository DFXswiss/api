export enum RealUnitLegalAgreement {
  RESIDENCE_CONFIRMATION = 'ResidenceConfirmation',
  TAX_DOMICILE_SELF_CERTIFICATION = 'TaxDomicileSelfCertification',
  REALUNIT_PRIVACY_POLICY = 'RealUnitPrivacyPolicy',
  REALUNIT_REGISTRATION_AGREEMENT = 'RealUnitRegistrationAgreement',
  AKTIONARIAT_TERMS_OF_SERVICE = 'AktionariatTermsOfService',
  DFX_TERMS_AND_CONDITIONS = 'DfxTermsAndConditions',
}

// The CURRENT version (format YYYYMMDD) of each agreement lives in Config.blockchain.realunit.legalVersions
// (config in Config, per CONTRIBUTING) — bump it there when a document changes; acceptances are stored per
// version so no migration is needed.
