import { KycContentType } from '../../../services/spider/dto/spider.dto';

export class KycFilesDto {
  name: string;
  contentType: KycContentType;
  kycType: KycDocumentType;
}

export enum KycDocumentType {
  IDENTIFICATION = 'Identification',
  CHATBOT = 'Chatbot',
  INCORPORATION_CERTIFICATE = 'IncorporationCertificate',
}
