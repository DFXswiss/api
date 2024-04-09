import { Injectable } from '@nestjs/common';
import { CountryRepository } from 'src/shared/models/country/country.repository';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { KycType } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Country } from './country.entity';

@Injectable()
export class CountryService {
  private readonly cache = new AsyncCache<Country>(CacheItemResetPeriod.EVERY_5_MINUTES);
  private readonly arrayCache = new AsyncCache<Country[]>(CacheItemResetPeriod.EVERY_5_MINUTES);

  constructor(private countryRepo: CountryRepository) {}

  async getAllCountry(): Promise<Country[]> {
    return this.arrayCache.get('all', () => this.countryRepo.find());
  }

  async getCountry(id: number): Promise<Country> {
    return this.cache.get(`${id}`, () => this.countryRepo.findOneBy({ id }));
  }

  async getCountryWithSymbol(symbol: string): Promise<Country> {
    return this.cache.get(symbol, () => this.countryRepo.findOneBy({ symbol }));
  }

  async getCountriesByKycType(kycType: KycType): Promise<Country[]> {
    switch (kycType) {
      case KycType.DFX:
        return this.arrayCache.get(kycType, () => this.countryRepo.findBy({ dfxEnable: true }));

      case KycType.LOCK:
        return this.arrayCache.get(kycType, () => this.countryRepo.findBy({ lockEnable: true }));
    }
  }
}
