import { EntityRepository, Repository } from 'typeorm';
import { FiatOutput } from './fiat-output.entity';

@EntityRepository(FiatOutput)
export class FiatOutputRepository extends Repository<FiatOutput> {}
