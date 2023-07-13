import { KycStatus, RiskState } from 'src/subdomains/generic/user/models/user-data/user-data.entity';

export enum KycContentType {
  PNG = 'image/png',
  JPEG = 'image/jpeg',
  JSON = 'application/json',
  PDF = 'application/pdf',
  TEXT = 'text/plain',
  XML = 'text/xml',
}

export enum KycRelationType {
  ADMINISTRATOR = 'administrator',
  BENEFICIAL_OWNER = 'beneficial-owner',
  CONTRACTING_PARTNER = 'contracting-partner',
  CONTROLLER = 'controller',
  CONVERSION_PARTNER = 'conversation-partner',
  INACTIVE = 'inactive',
}

export enum KycDocument {
  CHATBOT = 'chatbot-onboarding',
  ADDITIONAL_INFORMATION = 'additional-information',
  ADDRESS_CHECK = 'address-check',
  API_CHECK = 'api-check',
  API_UPLOAD_FINANCIAL_STATEMENT = 'api-upload-financial-statement',
  API_UPLOAD_IDENTIFICATION_DOCUMENT = 'api-upload-identification-document',
  APPROVAL_DOCUMENT = 'approval-document',
  BCP = 'bcp',
  BENEFICIAL_OWNER = 'beneficial-owner',
  CERTIFICATE_INHERITANCE = 'certificate-inheritance',
  CHATBOT_ONBOARDING = 'chatbot-onboarding',
  CHATBOT_VERIFICATION = 'chatbot-verification',
  CHECK = 'check',
  COMPLIANCE_CHECK = 'compliance-desk',
  CONTROLLER = 'controller',
  CRYPTO_CURRENCY_PROPERTIES = 'crypto-currency-properties',
  EDD = 'edd',
  FINANCIAL_STATEMENTS = 'financial-statements',
  INCORPORATION_CERTIFICATE = 'incorporation_certificate',
  INITIAL_CUSTOMER_INFORMATION = 'initial-customer-information',
  INITIATE_VIDEO_IDENTIFICATION = 'video-identification',
  INITIATE_ONLINE_IDENTIFICATION = 'online-identification',
  INITIATE_CHATBOT_IDENTIFICATION = 'onboarding-chatbot',
  INVOICE = 'invoice',
  MRZ = 'mrz',
  ONLINE_IDENTIFICATION = 'online-identification',
  PASSPORT_OR_ID = 'passport_or_id',
  REGISTRY_COMMERCE = 'registry_commerce',
  REPRESENTATION = 'representation',
  STATUTES_ASSOCIATION = 'statutes-association',
  TAX_DECLARATION = 'tax-declaration',
  USER_ADDED_DOCUMENT = 'user-added-document',
  VERIFICATION = 'verification',
  VIDEO_IDENTIFICATION = 'video_identification',
  IDENTIFICATION_LOG = 'identification-log',
}

export const KycDocuments: { [key: string]: { ident: KycDocument; document: KycDocument } } = {
  [KycStatus.CHATBOT]: {
    ident: KycDocument.INITIATE_CHATBOT_IDENTIFICATION,
    document: KycDocument.CHATBOT,
  },
  [KycStatus.ONLINE_ID]: {
    ident: KycDocument.INITIATE_ONLINE_IDENTIFICATION,
    document: KycDocument.ONLINE_IDENTIFICATION,
  },
  [KycStatus.VIDEO_ID]: {
    ident: KycDocument.INITIATE_VIDEO_IDENTIFICATION,
    document: KycDocument.VIDEO_IDENTIFICATION,
  },
};

export enum KycDocumentState {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum InitiateState {
  INITIATED = 'INITIATED',
  FAILED = 'FAILED',
  REFERENCE_NOT_FOUND = 'REFERENCE_NOT_FOUND',
}

export interface SubmitResponse {
  customerReference: string;
  customerId: number;
  customerVersionId: number;
}

export interface Challenge {
  key: string;
  challenge: string;
}

export interface CheckResponse {
  customerReference: string;
  customerId: number;
  customerVersionId: number;
  checkId: number;
  checkTime: number;
  riskState: RiskState;
}

export interface CreateResponse {
  customerReference: string;
  customerId: number;
  customerVersionId: number;
}

export interface InitiateResponse {
  state: InitiateState;
  reference: string;
  sessionUrl: string;

  locators: [
    {
      document: KycDocument;
      version: string;
    },
  ];
}

export interface SubmitResponse {
  customerReference: string;
  customerId: number;
  customerVersionId: number;
}

export interface DocumentVersion {
  name: string;
  state: KycDocumentState;
  creationTime: number;
  modificationTime: number;
}

export interface DocumentVersionPart {
  name: string;
  label: string;
  fileName: string;
  contentType: KycContentType;
  creationTime: number;
  modificationTime: number;
}

export interface CheckResult {
  checkId: number;
  checkTime: number;
  matchIds: number[];
  risks: Risk[];
}

export interface Risk {
  criterionPath: string;
  categoryKey: RiskState;
}

export interface RiskResult {
  result: RiskState | undefined;
  risks: Risk[];
}

export interface CustomerBase {
  reference: string;
  type: string;
  id?: number;
  versionId?: number;
  datesOfBirth: { year: string; month: string; day: string }[];
  citizenships: string[];
  countriesOfResidence: string[];
  emails: string[];
  telephones: string[];
  structuredAddresses: [
    {
      type: string;
      street: string;
      houseNumber: string;
      zipCode: string;
      city: string;
      countryCode: string;
    },
  ];
  gender: string;
  title: string;
  preferredLanguage: string;
  activationDate: { year: number; month: number; day: number };
  deactivationDate: { year: number; month: number; day: number };
}

export interface Customer extends CustomerBase {
  names: { firstName: string; lastName: string }[];
}

export interface Organization extends CustomerBase {
  names: string[];
}

export interface CustomerInformationResponse {
  reference: string;
  contractReference: string;
  contractState: string;
  lastCheckId: number;
  lastCheckTime: number;
  lastCheckVerificationId: number;
}

export interface ChatbotStyle {
  headerColor: string;
  textColor: string;
  warningColor: string;
  backgroundColor: string;
  overlayBackgroundColor: string;
  buttonColor: string;
  buttonBackgroundColor: string;
  bubbleLeftColor: string;
  bubbleLeftBackgroundColor: string;
  bubbleRightColor: string;
  bubbleRightBackgroundColor: string;
  htmlHeaderInclude: string;
  htmlBodyInclude: string;
}

export interface ChatbotResult {
  contribution: string;
  plannedDevelopmentOfAssets: string;
}

export interface ChatbotExport {
  attributes: { form: string };
}

export interface IdentificationLog {
  transactionId: string;
  identificationId: string;
}

export interface DocumentInfo {
  document: KycDocument;
  version: string;
  part: string;
  state: KycDocumentState;
  creationTime: Date;
  modificationTime: Date;
  label: string;
  fileName: string;
  contentType: KycContentType;
  url: string;
}
