import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Country } from './country.entity';

@Injectable()
export class CountryRepository extends BaseRepository<Country> {
  constructor(manager: EntityManager) {
    super(Country, manager);
  }
}
