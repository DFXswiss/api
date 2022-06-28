import { Entity, Column, Index, ManyToOne, OneToMany } from 'typeorm';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { User } from 'src/user/models/user/user.entity';
import { CryptoBuy } from 'src/payment/models/crypto-buy/crypto-buy.entity';
import { Deposit } from '../deposit/deposit.entity';
import { IEntity } from 'src/shared/models/entity';
import { BuyCrypto } from '../buy-crypto/buy-crypto.entity';
import { BankAccount } from '../bank-account/bank-account.entity';

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

  // TODO nullable false einstellen wenn alle vorhandenen bankAccount haben
  @ManyToOne(() => BankAccount, (bankAccount) => bankAccount.buys)
  bankAccount: BankAccount;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  asset: Asset;

  @ManyToOne(() => Deposit, { eager: true, nullable: true })
  deposit: Deposit;

  @OneToMany(() => CryptoBuy, (cryptoBuy) => cryptoBuy.buy)
  cryptoBuys: CryptoBuy[];

  @OneToMany(() => BuyCrypto, (buyCrypto) => buyCrypto.buy)
  buyCryptos: BuyCrypto[];
}
