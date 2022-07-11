import { IEntity } from 'src/shared/models/entity';
import { Entity, Column, OneToOne } from 'typeorm';
import { DepositRoute } from '../route/deposit-route.entity';

export enum Blockchain {
  DEFICHAIN = 'DeFiChain',
  BITCOIN = 'Bitcoin',
}

@Entity()
export class Deposit extends IEntity {
  @Column({ unique: true, length: 256 })
  address: string;

  @OneToOne(() => DepositRoute, (route) => route.deposit, { nullable: true })
  route: DepositRoute;

  @Column({ length: 256, default: Blockchain.DEFICHAIN })
  blockchain: Blockchain;
}
