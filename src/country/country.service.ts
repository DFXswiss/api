import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Country } from './country.entity';

@Injectable()
export class CountryService {
  constructor(
    @InjectRepository(Country)
    private countryRepository: Repository<Country>,
  ) {}
  async createCountry(user: any): Promise<string> {
    return '1';
  }

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
