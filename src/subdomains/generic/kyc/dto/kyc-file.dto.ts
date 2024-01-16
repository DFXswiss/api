import { ApiProperty } from '@nestjs/swagger';
import { KycWebhookData } from '../../user/services/webhook/dto/kyc-webhook.dto';

export enum KycFileType {
  NAME_CHECK = 'NameCheck',
  USER_INFORMATION = 'UserInformation',
  IDENTIFICATION = 'Identification',
  USER_NOTES = 'UserNotes',
  TRANSACTION_NOTES = 'TransactionNotes',
}

export enum KycContentType {
  PNG = 'image/png',
  JPEG = 'image/jpeg',
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

export interface KycFile {
  type: KycFileType;
  name: string;
  url: string;
  contentType: KycContentType;
  created: Date;
  updated: Date;
  metadata: Record<string, string>;
}

export class KycReportDto {
  @ApiProperty({ enum: KycReportType })
  type: KycReportType;

  @ApiProperty()
  contentType: string;
}

export class KycDataDto extends KycWebhookData {
  @ApiProperty()
  id: string;
}
