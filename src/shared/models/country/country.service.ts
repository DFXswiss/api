import { Injectable } from '@nestjs/common';
import { CreateCountryDto } from 'src/shared/models/country/dto/create-country.dto';
import { CountryRepository } from 'src/shared/models/country/country.repository';
import { UpdateCountryDto } from './dto/update-country.dto';
import { Country } from './country.entity';

@Injectable()
export class CountryService {
  constructor(private countryRepository: CountryRepository) {}

  async createCountry(createCountryDto: CreateCountryDto): Promise<any> {
    return this.countryRepository.createCountry(createCountryDto);
  }

  async getAllCountry(): Promise<any> {
    return this.countryRepository.getAllCountry();
  }

  async updateCountry(country: UpdateCountryDto): Promise<string> {
    return this.countryRepository.updateCountry(country);
  }

  async getCountry(id: number): Promise<Country> {
    return this.countryRepository.findOne(id);
  }
}
