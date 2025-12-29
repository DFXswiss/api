import { IEntity } from 'src/shared/models/entity';
import { PaymentLink } from 'src/subdomains/core/payment-link/entities/payment-link.entity';
import { Route } from 'src/subdomains/core/route/route.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, JoinColumn, OneToOne, TableInheritance } from 'typeorm';
import { Deposit } from '../deposit/deposit.entity';

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

  // child property declarations for TypeScript
  user?: User;
  route?: Route;
  paymentLinks?: PaymentLink[];

  // --- ENTITY METHODS --- //

  get userData(): UserData | undefined {
    return this.user?.userData;
  }
}
