import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Route } from 'src/subdomains/core/route/route.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Deposit } from 'src/subdomains/supporting/address-pool/deposit/deposit.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { BuyCrypto } from '../../process/entities/buy-crypto.entity';

@Entity()
@Index((buy: Buy) => [buy.iban, buy.asset, buy.deposit, buy.user], { unique: true })
export class Buy extends IEntity {
  @Column({ length: 256, nullable: true })
  iban?: string;

  @Column({ length: 256, unique: true })
  bankUsage: string;

  @Column({ type: 'float', default: 0 })
  volume: number; // CHF

  @Column({ type: 'float', default: 0 })
  annualVolume: number; // CHF

  @Column({ type: 'float', default: 0 })
  monthlyVolume: number; // CHF

  @Column({ default: true })
  active: boolean;

  @ManyToOne(() => User, (user) => user.buys)
  user: User;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  asset?: Asset;

  @ManyToOne(() => Deposit, { eager: true, nullable: true })
  deposit?: Deposit;

  @OneToOne(() => Route, { eager: true, nullable: true })
  @JoinColumn()
  route?: Route;

  @OneToMany(() => BuyCrypto, (buyCrypto) => buyCrypto.buy)
  buyCryptos: BuyCrypto[];

  // --- ENTITY METHODS --- //

  get userData(): UserData {
    return this.user.userData;
  }

  get targetAccount(): string {
    return this.user.address;
  }
}
