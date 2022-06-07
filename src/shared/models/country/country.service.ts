import { Injectable } from '@nestjs/common';
import { CountryRepository } from 'src/shared/models/country/country.repository';
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
}
