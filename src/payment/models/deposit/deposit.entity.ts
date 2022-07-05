import { IEntity } from 'src/shared/models/entity';
import { Entity, Column, OneToOne } from 'typeorm';
import { DepositRoute } from '../route/deposit-route.entity';

export enum ChainType {
  DEFICHAIN = 'defichain',
  BITCOIN = 'bitcoin',
}

@Entity()
export class Deposit extends IEntity {
  @Column({ unique: true, length: 256 })
  address: string;

  @OneToOne(() => DepositRoute, (route) => route.deposit, { nullable: true })
  route: DepositRoute;

  @Column({ unique: true, length: 256 })
  chain: ChainType;
}
