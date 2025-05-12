import { ApiProperty } from '@nestjs/swagger';
import { Blob } from 'src/integration/infrastructure/azure-storage.service';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycWebhookData } from '../../user/services/webhook/dto/kyc-webhook.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { ContentType } from '../enums/content-type.enum';
import { FileCategory } from '../enums/file-category.enum';

export enum FileType {
  NAME_CHECK = 'NameCheck',
  USER_INFORMATION = 'UserInformation',
  IDENTIFICATION = 'Identification',
  USER_NOTES = 'UserNotes',
  TRANSACTION_NOTES = 'TransactionNotes',
  STOCK_REGISTER = 'StockRegister',
  COMMERCIAL_REGISTER = 'CommercialRegister',
  RESIDENCE_PERMIT = 'ResidencePermit',
  ADDITIONAL_DOCUMENTS = 'AdditionalDocuments',
  AUTHORITY = 'Authority',
}

export enum FileSubType {
  GWG_FILE_COVER = 'GwGFileCover',
  BLOCKCHAIN_ADDRESS_ANALYSIS = 'BlockchainAddressAnalysis',
  ADDRESS_SIGNATURE = 'AddressSignature',
  BANK_TRANSACTION_VERIFICATION = 'BankTransactionVerification',
  IDENTIFICATION_FORM = 'IdentificationForm',
  PERSONAL_NAME_CHECK = 'PersonalNameCheck',
  BUSINESS_NAME_CHECK = 'BusinessNameCheck',
  RISK_PROFILE = 'RiskProfile',
  TX_AUDIT = 'TxAudit',
  ONBOARDING_REPORT = 'OnboardingReport',
  FORM_A = 'FormA',
  FORM_K = 'FormK',
  CUSTOMER_PROFILE = 'CustomerProfile',
  POST_DISPATCH = 'PostDispatch', // postversand
  LIMIT_REQUEST_USER_UPLOAD = 'LimitRequestUserUpload',
  LIMIT_REQUEST_REPORT = 'LimitRequestReport',
  COMMERCIAL_REGISTER_REPORT = 'CommercialRegisterReport',
  OWNER_DIRECTORY_REPORT = 'OwnerDirectoryReport',
  AUTHORITY_REPORT = 'AuthorityReport',
  GENERAL_NOTE = 'GeneralNote',
}

export enum KycReportType {
  IDENTIFICATION = 'Identification',
}

export interface KycFileBlob extends Blob {
  category: FileCategory;
  type: FileType;
  contentType: ContentType;
  path?: string;
}

export class CreateKycFileDto {
  name: string;
  type: FileType;
  protected: boolean;
  userData: UserData;
  kycStep?: KycStep;
  subType?: FileSubType;
}

export class KycFileDataDto {
  name: string;
  type: FileType;
  uid: string;
  contentType: string;
  content: Buffer;
}

export class KycReportDto {
  @ApiProperty({ enum: KycReportType })
  type: KycReportType;

  @ApiProperty()
  contentType: string;
}

export class KycClientDataDto extends KycWebhookData {
  @ApiProperty()
  id: string;
}
