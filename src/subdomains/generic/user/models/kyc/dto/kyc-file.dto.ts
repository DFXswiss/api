import { ApiProperty } from '@nestjs/swagger';

export enum KycDocumentType {
  IDENTIFICATION = 'Identification',
  CHATBOT = 'Chatbot',
  INCORPORATION_CERTIFICATE = 'IncorporationCertificate',
}

export class KycFileDto {
  @ApiProperty({ enum: KycDocumentType })
  type: KycDocumentType;

  @ApiProperty()
  contentType: string;
}
