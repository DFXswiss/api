import { Column, ManyToOne, OneToMany, ChildEntity } from 'typeorm';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { User } from 'src/user/models/user/user.entity';
import { BuyCrypto } from '../buy-crypto/entities/buy-crypto.entity';
import { DepositRoute } from '../route/deposit-route.entity';
import { CryptoInput } from '../crypto-input/crypto-input.entity';
import { Deposit } from '../deposit/deposit.entity';

@ChildEntity('Crypto')
export class CryptoRoute extends DepositRoute {
  @Column({ type: 'float', default: 0 })
  annualVolume: number;

  @ManyToOne(() => User, (user) => user.cryptoRoutes)
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
