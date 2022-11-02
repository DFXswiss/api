import { Entity, Column, Index, ManyToOne, OneToMany } from 'typeorm';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Deposit } from 'src/mix/models/deposit/deposit.entity';
import { IEntity } from 'src/shared/models/entity';
import { BankAccount } from 'src/subdomains/supporting/bank/bank-account/bank-account.entity';
import { BuyCrypto } from '../process/entities/buy-crypto.entity';

@Entity()
@Index('ibanAssetDepositUser', (buy: Buy) => [buy.iban, buy.asset, buy.deposit, buy.user], { unique: true })
export class Buy extends IEntity {
  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256, unique: true })
  bankUsage: string;

  @Column({ type: 'float', default: 0 })
  volume: number;

  @Column({ type: 'float', default: 0 })
  annualVolume: number;

  @Column({ default: true })
  active: boolean;

  @ManyToOne(() => User, (user) => user.buys)
  user: User;

  @ManyToOne(() => BankAccount, (bankAccount) => bankAccount.buys, { nullable: false })
  bankAccount: BankAccount;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  asset: Asset;

  @ManyToOne(() => Deposit, { eager: true, nullable: true })
  deposit: Deposit;

  @OneToMany(() => BuyCrypto, (buyCrypto) => buyCrypto.buy)
  buyCryptos: BuyCrypto[];
}
