import { EntityRepository, Repository } from 'typeorm';
import { CryptoInput } from '../entities/crypto-input.entity';

@EntityRepository(CryptoInput)
export class PayInRepository extends Repository<CryptoInput> {}
