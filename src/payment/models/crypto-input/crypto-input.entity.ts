import { Asset } from 'src/shared/models/asset/asset.entity';
import { DepositRoute } from 'src/payment/models/route/deposit-route.entity';
import { Sell } from 'src/payment/models/sell/sell.entity';
import { Staking } from 'src/payment/models/staking/staking.entity';
import { Entity, Column, ManyToOne, Index, OneToOne } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { CryptoSell } from '../crypto-sell/crypto-sell.entity';
import { CryptoStaking } from '../crypto-staking/crypto-staking.entity';
import { AmlCheck } from '../crypto-buy/enums/aml-check.enum';
import { CryptoRoute } from '../crypto-route/crypto-route.entity';
import { BuyFiat } from '../buy-fiat/buy-fiat.entity';

export enum CryptoInputType {
  RETURN = 'Return',
  CRYPTO_STAKING = 'CryptoStaking',
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

  @OneToOne(() => CryptoSell, (sell) => sell.cryptoInput, { nullable: true })
  cryptoSell?: CryptoSell;

  @OneToOne(() => BuyFiat, (buyFiat) => buyFiat.cryptoInput, { nullable: true })
  buyFiat?: BuyFiat;

  @OneToOne(() => CryptoStaking, (staking) => staking.cryptoInput, { nullable: true })
  cryptoStaking?: CryptoStaking;
}
