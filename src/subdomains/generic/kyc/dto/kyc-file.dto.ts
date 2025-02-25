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
