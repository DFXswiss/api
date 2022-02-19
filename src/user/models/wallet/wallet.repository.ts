import { EntityRepository, Repository } from 'typeorm';
import { Wallet } from './wallet.entity';

@EntityRepository(Wallet)
export class WalletRepository extends Repository<Wallet> {}
