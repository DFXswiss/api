import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { PaymentLink } from 'src/subdomains/core/payment-link/entities/payment-link.entity';
import { Route } from 'src/subdomains/core/route/route.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { ChildEntity, Column, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { Deposit } from '../../../../supporting/address-pool/deposit/deposit.entity';
import { DepositRoute, RouteType } from '../../../../supporting/address-pool/route/deposit-route.entity';

export const NoSwapBlockchains: Blockchain[] = [Blockchain.MONERO];

@ChildEntity('Crypto')
export class Swap extends DepositRoute {
  @Column({ type: 'float', default: 0 })
  annualVolume: number; // CHF

  @ManyToOne(() => User, (user) => user.swaps, { nullable: false })
  declare user: User;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  asset?: Asset;

  @ManyToOne(() => Deposit, { eager: true, nullable: true })
  targetDeposit?: Deposit;

  @OneToOne(() => Route, { eager: true, nullable: true })
  @JoinColumn()
  declare route?: Route;

  @OneToMany(() => BuyCrypto, (buyCrypto) => buyCrypto.cryptoRoute)
  buyCryptos: BuyCrypto[];

  @OneToMany(() => CryptoInput, (cryptoInput) => cryptoInput.route)
  cryptoInputs: CryptoInput[];

  @OneToMany(() => PaymentLink, (paymentLink) => paymentLink.route)
  declare paymentLinks: PaymentLink[];

  // --- ENTITY METHODS --- //

  get targetAccount(): string {
    return this.user.address;
  }
}

export function isSwapRoute(route: DepositRoute): route is Swap {
  return route.type === RouteType.CRYPTO;
}
