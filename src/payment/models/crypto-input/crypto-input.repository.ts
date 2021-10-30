import { EntityRepository, Repository } from 'typeorm';
import { CryptoInput } from './crypto-input.entity';

@EntityRepository(CryptoInput)
export class CryptoInputRepository extends Repository<CryptoInput> {}
