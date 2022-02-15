import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';
import { Country } from './country.entity';

@EntityRepository(Country)
export class CountryRepository extends Repository<Country> {
  async createCountry(createCountryDto: CreateCountryDto): Promise<any> {
    const country = this.create(createCountryDto);

    try {
      await this.save(country);
    } catch (error) {
      throw new ConflictException(error.message);
    }

    return country;
  }

  async getAllCountry(): Promise<any> {
    try {
      return await this.find();
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async updateCountry(editCountryDto: UpdateCountryDto): Promise<any> {
    try {
      const currentCountry = await this.findOne({ id: editCountryDto.id });
      if (!currentCountry) throw new NotFoundException('No matching country found');

      return Object.assign(currentCountry, await this.save(editCountryDto));
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }
}
