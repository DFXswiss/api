import { EntityRepository, Repository } from 'typeorm';
import { Fiat } from './fiat.entity';

@EntityRepository(Fiat)
export class FiatRepository extends Repository<Fiat> {}
