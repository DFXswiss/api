import { KycContentType } from '../../../services/spider/dto/spider.dto';

export class KycFileDto {
  type: KycDocumentType;
  contentType: KycContentType;
}

export enum KycDocumentType {
  IDENTIFICATION = 'Identification',
  CHATBOT = 'Chatbot',
  INCORPORATION_CERTIFICATE = 'IncorporationCertificate',
}
