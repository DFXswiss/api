import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LegalDocumentType } from '../legal-document.entity';

export class LegalDocumentDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: LegalDocumentType })
  type: LegalDocumentType;

  @ApiPropertyOptional({ description: 'ISO 639-1 language code, lowercase. Absent ⇒ language-agnostic.' })
  language?: string;

  @ApiProperty()
  version: string;

  @ApiProperty()
  url: string;
}
