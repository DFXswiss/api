import { EntityRepository, Repository } from 'typeorm';
import { FiatInput } from './fiat-input.entity';

@EntityRepository(FiatInput)
export class FiatInputRepository extends Repository<FiatInput> {}
