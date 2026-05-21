import { Injectable } from '@nestjs/common';
import { CountryRepository } from 'src/shared/models/country/country.repository';
import { KycType } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { Equal } from 'typeorm';
import { Country } from './country.entity';

@Injectable()
export class CountryService {
  constructor(private countryRepo: CountryRepository) {}

  async getAllCountry(): Promise<Country[]> {
    const countries = await this.countryRepo.findCached('all');
    // Sort by `displayOrder` ascending, with `name` as the tiebreaker.
    // Clients (e.g. the realunit-app country picker) consume this order
    // verbatim instead of hardcoded priority lists.
    return [...countries].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  }

  async getCountry(id: number): Promise<Country> {
    return this.countryRepo.findOneCachedBy(`${id}`, { id: Equal(id) });
  }

  async getCountryWithSymbol(symbol: string): Promise<Country> {
    return symbol?.length === 2
      ? this.countryRepo.findOneCachedBy(symbol, { symbol: Equal(symbol) })
      : this.countryRepo.findOneCachedBy(symbol, { symbol3: Equal(symbol) });
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
