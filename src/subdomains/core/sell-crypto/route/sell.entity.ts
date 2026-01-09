import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { PaymentLink } from 'src/subdomains/core/payment-link/entities/payment-link.entity';
import { Route } from 'src/subdomains/core/route/route.entity';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { DepositRoute, RouteType } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Check, ChildEntity, Column, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { BuyFiat } from '../process/buy-fiat.entity';

@Check(`"active" = 0 OR "bankDataId" IS NOT NULL OR "type" <> 'Sell'`)
@ChildEntity()
export class Sell extends DepositRoute {
  @Column({ length: 256 })
  iban: string;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  fiat?: Fiat;

  @Column({ type: 'float', default: 0 })
  annualVolume: number; // CHF

  @ManyToOne(() => User, (user) => user.sells, { nullable: false })
  declare user: User;

  @ManyToOne(() => BankData, (bankData) => bankData.sells, { nullable: true })
  bankData?: BankData;

  @OneToOne(() => Route, { eager: true, nullable: true })
  @JoinColumn()
  declare route?: Route;

  @OneToMany(() => CryptoInput, (cryptoInput) => cryptoInput.route)
  cryptoInputs: CryptoInput[];

  @OneToMany(() => BuyFiat, (buyFiat) => buyFiat.sell)
  buyFiats: BuyFiat[];

  @OneToMany(() => PaymentLink, (paymentLink) => paymentLink.route)
  declare paymentLinks: PaymentLink[];

  // --- ENTITY METHODS --- //

  get targetAccount(): string {
    return this.iban;
  }
}

export function isSellRoute(route: DepositRoute): route is Sell {
  return route.type === RouteType.SELL;
}
