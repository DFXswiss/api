import { Injectable } from '@nestjs/common';
import { CountryRepository } from 'src/shared/models/country/country.repository';
import { KycType } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Country } from './country.entity';

@Injectable()
export class CountryService {
  constructor(private countryRepo: CountryRepository) {}

  async getAllCountry(): Promise<Country[]> {
    return this.countryRepo.findCached('all');
  }

  async getCountry(id: number): Promise<Country> {
    return this.countryRepo.findOneCachedBy(`${id}`, { id });
  }

  async getCountryWithSymbol(symbol: string): Promise<Country> {
    return this.countryRepo.findOneCachedBy(symbol, { symbol });
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
