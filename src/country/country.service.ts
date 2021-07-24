import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Country } from './country.entity';
import { CreateCountryDto } from 'src/country/dto/create-country.dto';
import { CountryRepository } from 'src/country/country.repository';
import { UpdateCountryDto } from './dto/update-country.dto';

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

  async getCountry(key: any): Promise<any> {
    return this.countryRepository.getCountry(key);
  }
}
