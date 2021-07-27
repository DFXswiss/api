import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';
import { Country } from './country.entity';
import { isString } from 'class-validator';

@EntityRepository(Country)
export class CountryRepository extends Repository<Country> {
  async createCountry(createCountryDto: CreateCountryDto): Promise<any> {
    if (createCountryDto.id) delete createCountryDto['id'];

    const country = this.create(createCountryDto);

    try {
      await this.save(country);
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException();
    }

    return country;
  }

  async getAllCountry(): Promise<any> {
    return await this.find();
  }

  async getCountry(key: any): Promise<any> {
    if (!isNaN(key.key)) {
      let country = await this.findOne({ id: key.key });

      if (country) return country;
    } else if (isString(key.key)) {
      let country = await this.findOne({ symbol: key.key });

      if (country) return country;

      country = await this.findOne({ name: key.key });

      if (country) return country;

      throw new NotFoundException('No matching country found');
    }else if (!isNaN(key)) {
      let country = await this.findOne({ id: key });

      if (country) return country;
    } else if (isString(key)) {
      let country = await this.findOne({ symbol: key });

      if (country) return country;

      country = await this.findOne({ name: key });

      if (country) return country;
      
      throw new NotFoundException('No matching country found');
    } else if (key.id) {
      let country = await this.findOne({ id: key.id });

      if (country) return country;

      throw new NotFoundException('No matching country found');
    } else if (key.symbol) {
      let country = await this.findOne({ name: key.symbol });

      if (country) return country;

      throw new NotFoundException('No matching country found');
    } else if (key.name) {
      let country = await this.findOne({ name: key.symbol });

      if (country) return country;

      throw new NotFoundException('No matching country found');
    }

    throw new BadRequestException(
      'key must be number or string or JSON-Object',
    );
  }

  async updateCountry(editCountryDto: UpdateCountryDto): Promise<any> {
    const currentCountry = await this.findOne({ id: editCountryDto.id });
    if (!currentCountry)
      throw new NotFoundException('No matching country found');
    
      await this.save(editCountryDto);

    return await this.findOne({ id: editCountryDto.id });
  }
}
