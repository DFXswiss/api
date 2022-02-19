import { EntityRepository, Repository } from 'typeorm';
import { Country } from './country.entity';

@EntityRepository(Country)
export class CountryRepository extends Repository<Country> {}
