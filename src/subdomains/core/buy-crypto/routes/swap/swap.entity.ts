import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { ChildEntity, Column, ManyToOne, OneToMany } from 'typeorm';
import { Deposit } from '../../../../supporting/address-pool/deposit/deposit.entity';
import { DepositRoute } from '../../../../supporting/address-pool/route/deposit-route.entity';

@ChildEntity('Crypto')
export class Swap extends DepositRoute {
  @Column({ type: 'float', default: 0 })
  annualVolume: number; // CHF

  @ManyToOne(() => User, (user) => user.cryptoRoutes, { nullable: false })
  user: User;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  asset: Asset;

  @ManyToOne(() => Deposit, { eager: true, nullable: true })
  targetDeposit: Deposit;

  @OneToMany(() => BuyCrypto, (buyCrypto) => buyCrypto.cryptoRoute)
  buyCryptos: BuyCrypto[];

  @OneToMany(() => CryptoInput, (cryptoInput) => cryptoInput.route)
  cryptoInputs: CryptoInput[];
}
