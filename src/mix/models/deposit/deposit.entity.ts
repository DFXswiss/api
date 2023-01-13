import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IEntity } from 'src/shared/models/entity';
import { Entity, Column, OneToOne, Index } from 'typeorm';
import { DepositRoute } from '../route/deposit-route.entity';

@Entity()
@Index('oneDepositPerBlockchain', (deposit: Deposit) => [deposit.address, deposit.blockchain], { unique: true })
export class Deposit extends IEntity {
  @Column({ length: 256 })
  address: string;

  @OneToOne(() => DepositRoute, (route) => route.deposit, { nullable: true })
  route: DepositRoute;

  @Column({ length: 256, default: Blockchain.DEFICHAIN })
  blockchain: Blockchain;
}
