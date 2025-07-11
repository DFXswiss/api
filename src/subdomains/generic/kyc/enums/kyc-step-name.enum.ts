export enum KycStepName {
  // standard KYC
  CONTACT_DATA = 'ContactData',
  PERSONAL_DATA = 'PersonalData',
  NATIONALITY_DATA = 'NationalityData',
  LEGAL_ENTITY = 'LegalEntity',
  OWNER_DIRECTORY = 'OwnerDirectory',
  COMMERCIAL_REGISTER = 'CommercialRegister',
  SIGNATORY_POWER = 'SignatoryPower',
  AUTHORITY = 'Authority',
  BENEFICIAL_OWNER = 'BeneficialOwner',
  OPERATIONAL_ACTIVITY = 'OperationalActivity',
  IDENT = 'Ident',
  FINANCIAL_DATA = 'FinancialData',
  ADDITIONAL_DOCUMENTS = 'AdditionalDocuments',
  RESIDENCE_PERMIT = 'ResidencePermit',
  DFX_APPROVAL = 'DfxApproval',

  // additional features
  PAYMENT_AGREEMENT = 'PaymentAgreement',
}
