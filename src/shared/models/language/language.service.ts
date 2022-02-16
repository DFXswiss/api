import { Injectable } from '@nestjs/common';
import { LanguageRepository } from 'src/shared/models/language/language.repository';
import { Language } from './language.entity';

@Injectable()
export class LanguageService {
  constructor(private languageRepo: LanguageRepository) {}

  async getAllLanguage(): Promise<Language[]> {
    return this.languageRepo.find();
  }

  async getLanguage(id: number): Promise<Language> {
    return this.languageRepo.findOne(id);
  }
}
