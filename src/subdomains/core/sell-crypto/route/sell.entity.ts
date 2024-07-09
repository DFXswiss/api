import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { DepositRoute } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { ChildEntity, Column, ManyToOne, OneToMany } from 'typeorm';
import { BankAccount } from '../../../supporting/bank/bank-account/bank-account.entity';
import { PaymentLink } from '../../payment-link/entities/payment-link.entity';
import { BuyFiat } from '../process/buy-fiat.entity';

@ChildEntity()
export class Sell extends DepositRoute {
  @Column({ length: 256 })
  iban: string;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  fiat: Fiat;

  @Column({ type: 'float', default: 0 })
  annualVolume: number; // CHF

  @ManyToOne(() => User, (user) => user.sells, { nullable: false })
  user: User;

  @ManyToOne(() => BankAccount, (bankAccount) => bankAccount.sells)
  bankAccount: BankAccount;

  @OneToMany(() => CryptoInput, (cryptoInput) => cryptoInput.route)
  cryptoInputs: CryptoInput[];

  @OneToMany(() => BuyFiat, (buyFiat) => buyFiat.sell)
  buyFiats: BuyFiat[];

  @OneToMany(() => PaymentLink, (paymentLink) => paymentLink.route)
  paymentLinks: PaymentLink[];

  // --- ENTITY METHODS --- //

  get userData(): UserData {
    return this.user.userData;
  }
}
