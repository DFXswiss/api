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
  PHONE_CHANGE = 'PhoneChange',
  ADDRESS_CHANGE = 'AddressChange',
  NAME_CHANGE = 'NameChange',

  // external registrations
  REALUNIT_REGISTRATION = 'RealUnitRegistration',
}

export const KycStepCancelable = [KycStepName.ADDRESS_CHANGE, KycStepName.PHONE_CHANGE, KycStepName.NAME_CHANGE];
export const KycStepIdentRequiredForReview = [
  KycStepName.LEGAL_ENTITY,
  KycStepName.SOLE_PROPRIETORSHIP_CONFIRMATION,
  KycStepName.AUTHORITY,
  KycStepName.OWNER_DIRECTORY,
  KycStepName.SIGNATORY_POWER,
  KycStepName.BENEFICIAL_OWNER,
  KycStepName.OPERATIONAL_ACTIVITY,
];
// Steps the user can never action because they are a backend/DFX-side decision.
// While such a step is open it is "awaiting DFX", so it must never surface to
// the client as the actionable `currentStep` / `InProgress` — it reads as
// PendingReview instead.
export const KycStepNonUserActionable = [KycStepName.DFX_APPROVAL];
export const KycStepRepeatable = [
  KycStepName.ADDRESS_CHANGE,
  KycStepName.PHONE_CHANGE,
  KycStepName.NAME_CHANGE,
  KycStepName.CONTACT_DATA,
];
