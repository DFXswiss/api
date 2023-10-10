import { IEntity } from 'src/shared/models/entity';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { Column, Entity, JoinColumn, OneToOne, TableInheritance } from 'typeorm';
import { Deposit } from '../deposit/deposit.entity';

export type DepositRouteType = Sell | Staking | CryptoRoute;

export enum RouteType {
  SELL = 'Sell',
  CRYPTO = 'Crypto',
}

@Entity()
@TableInheritance({ column: { type: 'nvarchar', name: 'type' } })
export class DepositRoute extends IEntity {
  @Column()
  type: RouteType;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'float', default: 0 })
  volume: number; // CHF

  @OneToOne(() => Deposit, (deposit) => deposit.route, { eager: true, nullable: false })
  @JoinColumn()
  deposit: Deposit;
}
