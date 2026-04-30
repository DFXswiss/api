import { ApiProperty } from '@nestjs/swagger';

export enum KycDocumentType {
  IDENTIFICATION = 'Identification',
  CHATBOT = 'Chatbot',
  INCORPORATION_CERTIFICATE = 'IncorporationCertificate',
}

export class KycFileDto {
  @ApiProperty({ enum: KycDocumentType, deprecated: true })
  type: KycDocumentType;

  @ApiProperty({ deprecated: true })
  contentType: string;
}
