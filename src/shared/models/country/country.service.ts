import { Injectable } from '@nestjs/common';
import { CountryRepository } from 'src/shared/models/country/country.repository';
import { KycType } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Equal } from 'typeorm';
import { Country } from './country.entity';

@Injectable()
export class CountryService {
  constructor(private countryRepo: CountryRepository) {}

  async getAllCountry(): Promise<Country[]> {
    return this.countryRepo.findCached('all');
  }

  async getCountry(id: number): Promise<Country> {
    return this.countryRepo.findOneCachedBy(`${id}`, { id: Equal(id) });
  }

  async getCountryWithSymbol(symbol: string): Promise<Country> {
    return this.countryRepo.findOneCachedBy(symbol, { symbol: Equal(symbol) });
  }

  async getCountryWithSymbol3(symbol3: string): Promise<Country> {
    return this.countryRepo.findOneCachedBy(symbol3, { symbol3: Equal(symbol3) });
  }

  async getCountriesByKycType(kycType: KycType): Promise<Country[]> {
    switch (kycType) {
      case KycType.DFX:
        return this.countryRepo.findCachedBy(kycType, { dfxEnable: true });

      case KycType.LOCK:
        return this.countryRepo.findCachedBy(kycType, { lockEnable: true });
    }
  }
}
