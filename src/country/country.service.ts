import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { Country } from './country.entity';
export class CountryService {
  async createCountry(user: any): Promise<string> {
    return '1';
  }

  async findCountryByAddress(): Promise<string> {
    return '2';
  }

  async updateCountry(user: any): Promise<string> {
    return '3';
  }

  async findCountryBySymbol(key:any): Promise<string> {
    return '4';
  }
}
