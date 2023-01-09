import { Asset } from 'src/shared/models/asset/asset.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/sell/sell.entity';
import { Staking } from 'src/mix/models/staking/staking.entity';
import { Entity, Column, ManyToOne, Index, OneToOne } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { CryptoStaking } from '../crypto-staking/crypto-staking.entity';
import { CryptoRoute } from '../crypto-route/crypto-route.entity';
import { BuyFiat } from '../../../subdomains/core/sell-crypto/buy-fiat/buy-fiat.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { DepositRoute } from '../route/deposit-route.entity';

export enum CryptoInputType {
  RETURN = 'Return',
  CRYPTO_STAKING = 'CryptoStaking',
  CRYPTO_STAKING_INVALID = 'CryptoStakingInvalid',
  BUY_FIAT = 'BuyFiat',
  BUY_CRYPTO = 'BuyCrypto',
  CRYPTO_CRYPTO = 'CryptoCrypto',
  UNKNOWN = 'Unknown',
}

@Entity()
@Index('txAssetRouteVout', (input: CryptoInput) => [input.inTxId, input.asset, input.route, input.vout], {
  unique: true,
})
export class CryptoInput extends IEntity {
  @Column({ length: 256 })
  inTxId: string;

  @Column({ type: 'integer', nullable: true })
  vout: number;

  @Column({ length: 256, nullable: true })
  outTxId: string;

  @Column({ length: 256, nullable: true })
  returnTxId: string;

  @Column({ type: 'integer', nullable: true })
  blockHeight: number;

  @Column({ type: 'float' })
  amount: number;

  @Column({ type: 'float', nullable: true })
  forwardFeeAmount: number;

  @Column({ type: 'float', nullable: true })
  btcAmount?: number;

  @Column({ type: 'float', nullable: true })
  usdtAmount?: number;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  asset: Asset;

  @Column({ length: 256, nullable: false })
  type: CryptoInputType;

  @ManyToOne(() => DepositRoute, { nullable: false })
  route: Sell | Staking | CryptoRoute;

  @Column({ default: false })
  isConfirmed: boolean;

  @Column({ length: 256, default: AmlCheck.FAIL })
  amlCheck: AmlCheck;

  @OneToOne(() => BuyFiat, (buyFiat) => buyFiat.cryptoInput, { nullable: true })
  buyFiat?: BuyFiat;

  @OneToOne(() => CryptoStaking, (staking) => staking.cryptoInput, { nullable: true })
  cryptoStaking?: CryptoStaking;

  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.cryptoInput, { nullable: true })
  buyCrypto: BuyCrypto;
}
