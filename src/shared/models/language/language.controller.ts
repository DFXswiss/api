import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Language } from './language.entity';
import { LanguageService } from './language.service';

@ApiTags('language')
@Controller('language')
export class LanguageController {
  constructor(private readonly languageService: LanguageService) {}

  @Get()
  @ApiBearerAuth()
  async getAllLanguage(): Promise<Language[]> {
    return this.languageService.getAllLanguage();
  }
}
