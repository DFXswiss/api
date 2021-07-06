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

@Injectable()
export class CountryService {
  constructor(private countryRepository: CountryRepository) {}
  
  async createCountry(createCountryDto: CreateCountryDto): Promise<void>{
    this.countryRepository.createCountry(createCountryDto);
  }

  // async createCountry(user: any): Promise<string> {
  //   return '1';
  // }

 

  async getCountry(): Promise<string> {
    return '2';
  }

  async updateCountry(user: any): Promise<string> {
    return '3';
  }

  async findCountryBySymbol(key:any): Promise<string> {
    return '4';
  }
}
