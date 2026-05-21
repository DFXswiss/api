import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { LegalDocumentDtoMapper } from './dto/legal-document-dto.mapper';
import { LegalDocumentDto } from './dto/legal-document.dto';
import { LegalDocumentType } from './legal-document.entity';
import { LegalDocumentService } from './legal-document.service';

class LegalDocumentQueryDto {
  @ApiPropertyOptional({ enum: LegalDocumentType })
  @IsOptional()
  @IsEnum(LegalDocumentType)
  type?: LegalDocumentType;

  @ApiPropertyOptional({ description: 'ISO 639-1 language code (e.g. `de`, `en`)' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z]{2}$/, { message: 'language must be a 2-letter ISO 639-1 code' })
  language?: string;
}

@ApiTags('LegalDocument')
@Controller('legal-document')
export class LegalDocumentController {
  constructor(private readonly service: LegalDocumentService) {}

  @Get()
  @ApiOkResponse({ type: LegalDocumentDto, isArray: true })
  async getDocuments(@Query() query: LegalDocumentQueryDto): Promise<LegalDocumentDto[]> {
    const documents = await this.service.getDocuments({ type: query.type, language: query.language });
    return LegalDocumentDtoMapper.entitiesToDto(documents);
  }
}
