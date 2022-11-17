import { Injectable } from '@nestjs/common';
import { CountryRepository } from 'src/shared/models/country/country.repository';
import { KycType } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Country } from './country.entity';

@Injectable()
export class CountryService {
  constructor(private countryRepo: CountryRepository) {}

  async getAllCountry(): Promise<Country[]> {
    return this.countryRepo.find();
  }

  async getCountry(id: number): Promise<Country> {
    return this.countryRepo.findOne(id);
  }

  async getCountryWithSymbol(symbol: string): Promise<Country> {
    return this.countryRepo.findOne({ where: { symbol } });
  }

  async getCountriesByKycType(kycType: KycType): Promise<Country[]> {
    switch (kycType) {
      case KycType.DFX:
        return await this.countryRepo.find({ where: { dfxEnable: true } });

      case KycType.LOCK:
        return await this.countryRepo.find({ where: { lockEnable: true } });
    }
  }
}
