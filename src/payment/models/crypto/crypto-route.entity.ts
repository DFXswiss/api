import { Entity, Column, ManyToOne, OneToMany } from 'typeorm';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { User } from 'src/user/models/user/user.entity';
import { BuyCrypto } from '../buy-crypto/buy-crypto.entity';
import { DepositRoute } from '../route/deposit-route.entity';
import { CryptoInput } from '../crypto-input/crypto-input.entity';

@Entity()
export class CryptoRoute extends DepositRoute {
  @Column({ type: 'float', default: 0 })
  annualVolume: number;

  @ManyToOne(() => User, (user) => user.cryptos)
  user: User;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  asset: Asset;

  //Deposit

  @OneToMany(() => BuyCrypto, (buyCrypto) => buyCrypto.buy)
  buyCryptos: BuyCrypto[];

  @OneToMany(() => CryptoInput, (cryptoInput) => cryptoInput.route)
  cryptoInputs: CryptoInput[];
}
