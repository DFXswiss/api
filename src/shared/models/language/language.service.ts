import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { LanguageRepository } from 'src/shared/models/language/language.repository';
import { Language } from './language.entity';

@Injectable()
export class LanguageService {
  private ipCountryToLanguage: { [key: string]: string } = {
    DE: 'DE',
    AT: 'DE',
    CH: 'DE',
    LI: 'DE',
    IT: 'IT',
    FR: 'FR',
  };

  constructor(private languageRepo: LanguageRepository) {}

  async getAllLanguage(): Promise<Language[]> {
    return this.languageRepo.findCached('all');
  }

  async getLanguage(id: number): Promise<Language> {
    return this.languageRepo.findOneCachedBy(`${id}`, { id });
  }

  async getLanguageBySymbol(symbol: string): Promise<Language> {
    return this.languageRepo.findOneCachedBy(symbol, { symbol });
  }

  async getLanguageByIpCountry(ipCountry: string): Promise<Language> {
    const symbol = this.ipCountryToLanguage[ipCountry] ?? Config.defaultLanguage.toUpperCase();
    return this.languageRepo.findOne({ where: { symbol } });
  }
}
