import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { Country } from './country.entity';

@Injectable()
export class CountryRepository extends CachedRepository<Country> {
  constructor(manager: EntityManager) {
    super(Country, manager);
  }
}
