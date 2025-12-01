export enum KycStepName {
  // standard KYC
  CONTACT_DATA = 'ContactData',
  PERSONAL_DATA = 'PersonalData',
  NATIONALITY_DATA = 'NationalityData',
  RECOMMENDATION = 'Recommendation',
  OWNER_DIRECTORY = 'OwnerDirectory',
  COMMERCIAL_REGISTER = 'CommercialRegister', // deprecated
  LEGAL_ENTITY = 'LegalEntity',
  SOLE_PROPRIETORSHIP_CONFIRMATION = 'SoleProprietorshipConfirmation',
  SIGNATORY_POWER = 'SignatoryPower',
  AUTHORITY = 'Authority',
  BENEFICIAL_OWNER = 'BeneficialOwner',
  OPERATIONAL_ACTIVITY = 'OperationalActivity',
  IDENT = 'Ident',
  FINANCIAL_DATA = 'FinancialData',
  ADDITIONAL_DOCUMENTS = 'AdditionalDocuments',
  RESIDENCE_PERMIT = 'ResidencePermit',
  STATUTES = 'Statutes',
  DFX_APPROVAL = 'DfxApproval',

  // additional features
  PAYMENT_AGREEMENT = 'PaymentAgreement',
  RECALL_AGREEMENT = 'RecallAgreement',
}
