import { EntityRepository, Repository } from 'typeorm';
import { PayIn } from '../entities/payin.entity';

@EntityRepository(PayIn)
export class PayInRepository extends Repository<PayIn> {}
