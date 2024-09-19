import { ApiProperty } from '@nestjs/swagger';
import { Blob } from 'src/integration/infrastructure/azure-storage.service';
import { KycWebhookData } from '../../user/services/webhook/dto/kyc-webhook.dto';

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

export enum ContentType {
  PNG = 'image/png',
  JPEG = 'image/jpeg',
  JPG = 'image/jpg',
  JSON = 'application/json',
  PDF = 'application/pdf',
  TEXT = 'text/plain',
  XML = 'text/xml',
  ZIP = 'application/zip',
  MP3 = 'audio/mpeg',
}

export enum KycReportType {
  IDENTIFICATION = 'Identification',
}

export interface KycFile extends Blob {
  type: FileType;
  contentType: ContentType;
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
