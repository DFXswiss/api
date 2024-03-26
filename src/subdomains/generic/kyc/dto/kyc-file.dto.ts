import { ApiProperty } from '@nestjs/swagger';
import { KycWebhookData } from '../../user/services/webhook/dto/kyc-webhook.dto';

export enum FileType {
  NAME_CHECK = 'NameCheck',
  USER_INFORMATION = 'UserInformation',
  IDENTIFICATION = 'Identification',
  USER_NOTES = 'UserNotes',
  TRANSACTION_NOTES = 'TransactionNotes',
  SUPPORT_ISSUE = 'SupportIssue',
}

export enum ContentType {
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

export interface File {
  type: FileType;
  name: string;
  url: string;
  contentType: ContentType;
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

export class KycClientDataDto extends KycWebhookData {
  @ApiProperty()
  id: string;
}
