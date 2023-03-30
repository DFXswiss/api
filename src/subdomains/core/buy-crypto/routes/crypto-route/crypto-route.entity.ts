import { Column, ManyToOne, OneToMany, ChildEntity } from 'typeorm';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Deposit } from '../../../../supporting/address-pool/deposit/deposit.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { DepositRoute } from '../../../../supporting/address-pool/route/deposit-route.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';

@ChildEntity('Crypto')
export class CryptoRoute extends DepositRoute {
  @Column({ type: 'float', default: 0 })
  annualVolume: number;

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
