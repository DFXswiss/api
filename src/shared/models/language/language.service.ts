import { Injectable } from '@nestjs/common';
import { LanguageRepository } from 'src/shared/models/language/language.repository';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Language } from './language.entity';

@Injectable()
export class LanguageService {
  private readonly cache = new AsyncCache<Language>(CacheItemResetPeriod.EVERY_5_MINUTES);
  private readonly arrayCache = new AsyncCache<Language[]>(CacheItemResetPeriod.EVERY_5_MINUTES);

  constructor(private languageRepo: LanguageRepository) {}

  async getAllLanguage(): Promise<Language[]> {
    return this.arrayCache.get('all', () => this.languageRepo.find());
  }

  async getLanguage(id: number): Promise<Language> {
    return this.cache.get(`${id}`, () => this.languageRepo.findOneBy({ id }));
  }

  async getLanguageBySymbol(symbol: string): Promise<Language> {
    return this.cache.get(symbol, () => this.languageRepo.findOneBy({ symbol }));
  }
}
