import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { Route } from 'src/subdomains/core/route/route.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { ChildEntity, Column, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { Deposit } from '../../../../supporting/address-pool/deposit/deposit.entity';
import { DepositRoute } from '../../../../supporting/address-pool/route/deposit-route.entity';

export const SwapInputBlockchains: Blockchain[] = [
  Blockchain.BITCOIN,
  Blockchain.LIGHTNING,
  Blockchain.ETHEREUM,
  Blockchain.ARBITRUM,
  Blockchain.OPTIMISM,
  Blockchain.POLYGON,
  Blockchain.BINANCE_SMART_CHAIN,
  Blockchain.BASE,
];

@ChildEntity('Crypto')
export class Swap extends DepositRoute {
  @Column({ type: 'float', default: 0 })
  annualVolume: number; // CHF

  @ManyToOne(() => User, (user) => user.swaps, { nullable: false })
  user: User;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  asset?: Asset;

  @ManyToOne(() => Deposit, { eager: true, nullable: true })
  targetDeposit?: Deposit;

  @OneToOne(() => Route, { eager: true, nullable: true })
  @JoinColumn()
  route?: Route;

  @OneToMany(() => BuyCrypto, (buyCrypto) => buyCrypto.cryptoRoute)
  buyCryptos: BuyCrypto[];

  @OneToMany(() => CryptoInput, (cryptoInput) => cryptoInput.route)
  cryptoInputs: CryptoInput[];

  // --- ENTITY METHODS --- //

  get userData(): UserData {
    return this.user.userData;
  }

  get targetAccount(): string {
    return this.user.address;
  }
}
