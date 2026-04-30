import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { LanguageDtoMapper } from './dto/language-dto.mapper';
import { LanguageDto } from './dto/language.dto';
import { LanguageService } from './language.service';

@ApiTags('Language')
@Controller('language')
export class LanguageController {
  constructor(private readonly languageService: LanguageService) {}

  @Get()
  @ApiOkResponse({ type: LanguageDto, isArray: true })
  async getAllLanguage(): Promise<LanguageDto[]> {
    return this.languageService.getAllLanguage().then(LanguageDtoMapper.entitiesToDto);
  }
}
