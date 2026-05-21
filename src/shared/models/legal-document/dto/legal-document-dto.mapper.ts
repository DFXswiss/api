import { LegalDocument } from '../legal-document.entity';
import { LegalDocumentDto } from './legal-document.dto';

export class LegalDocumentDtoMapper {
  static entityToDto(document: LegalDocument): LegalDocumentDto {
    const dto: LegalDocumentDto = {
      id: document.id,
      type: document.type,
      language: document.language ?? undefined,
      version: document.version,
      url: document.url,
    };

    return Object.assign(new LegalDocumentDto(), dto);
  }

  static entitiesToDto(documents: LegalDocument[]): LegalDocumentDto[] {
    return documents.map(LegalDocumentDtoMapper.entityToDto);
  }
}
