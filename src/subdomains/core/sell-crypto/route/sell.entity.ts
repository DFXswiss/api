import { Column, ManyToOne, ChildEntity, OneToMany } from 'typeorm';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { CryptoInput } from '../../../../mix/models/crypto-input/crypto-input.entity';
import { BankAccount } from '../../../supporting/bank/bank-account/bank-account.entity';
import { BuyFiat } from '../process/buy-fiat.entity';
import { DepositRoute } from 'src/mix/models/route/deposit-route.entity';

@ChildEntity()
export class Sell extends DepositRoute {
  @Column({ length: 256 })
  iban: string;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  fiat: Fiat;

  @Column({ type: 'float', default: 0 })
  annualVolume: number;

  @ManyToOne(() => User, (user) => user.sells, { nullable: false })
  user: User;

  @ManyToOne(() => BankAccount, (bankAccount) => bankAccount.sells)
  bankAccount: BankAccount;

  @OneToMany(() => CryptoInput, (cryptoInput) => cryptoInput.route)
  cryptoInputs: CryptoInput[];

  @OneToMany(() => BuyFiat, (buyFiat) => buyFiat.sell)
  buyFiats: BuyFiat[];
}
