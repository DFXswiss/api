import { Injectable } from '@nestjs/common';
import { CountryRepository } from 'src/shared/models/country/country.repository';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { KycType } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Country } from './country.entity';

@Injectable()
export class CountryService {
  private readonly cache = new AsyncCache<Country>(60);

  constructor(private countryRepo: CountryRepository) {}

  async getAllCountry(): Promise<Country[]> {
    return this.countryRepo.find();
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
        return this.countryRepo.findBy({ dfxEnable: true });

      case KycType.LOCK:
        return this.countryRepo.findBy({ lockEnable: true });
    }
  }
}
