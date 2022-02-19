import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Language } from './language.entity';
import { LanguageService } from './language.service';

@ApiTags('language')
@Controller('language')
export class LanguageController {
  constructor(private readonly languageService: LanguageService) {}

  @Get()
  async getAllLanguage(): Promise<Language[]> {
    return this.languageService.getAllLanguage();
  }
}
