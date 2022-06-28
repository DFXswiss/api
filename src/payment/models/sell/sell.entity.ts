import { Column, ManyToOne, ChildEntity, OneToMany } from 'typeorm';
import { User } from 'src/user/models/user/user.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { DepositRoute } from '../route/deposit-route.entity';
import { CryptoInput } from '../crypto-input/crypto-input.entity';
import { BankAccount } from '../bank-account/bank-account.entity';
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

  // TODO nullable false einstellen wenn alle vorhandenen bankAccount haben
  @ManyToOne(() => BankAccount, (bankAccount) => bankAccount.sells)
  bankAccount: BankAccount;

  @OneToMany(() => CryptoInput, (cryptoInput) => cryptoInput.route)
  cryptoInputs: CryptoInput[];
}
