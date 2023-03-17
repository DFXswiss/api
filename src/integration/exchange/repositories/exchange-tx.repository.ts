import { EntityRepository, Repository } from 'typeorm';
import { ExchangeTx } from '../entities/exchange-tx.entity';

@EntityRepository(ExchangeTx)
export class ExchangeTxRepository extends Repository<ExchangeTx> {}
