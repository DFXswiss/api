import { Asset } from 'src/shared/models/asset/asset.entity';
import { DepositRoute } from 'src/payment/models/route/deposit-route.entity';
import { Sell } from 'src/payment/models/sell/sell.entity';
import { Staking } from 'src/payment/models/staking/staking.entity';
import { Entity, Column, ManyToOne, Index, OneToOne } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { CryptoSell } from '../crypto-sell/crypto-sell.entity';
import { CryptoStaking } from '../crypto-staking/crypto-staking.entity';
import { AmlCheck } from '../crypto-buy/enums/aml-check.enum';

export enum CryptoInputType {
  RETURN = 'Return',
  CRYPTO_STAKING = 'CryptoStaking',
  BUY_FIAT = 'BuyFiat',
  CRYPTO_CRYPTO = 'CryptoCrypto',
  UNKNOWN = 'Unknown',
}

@Entity()
@Index('txAssetRoute', (input: CryptoInput) => [input.inTxId, input.asset, input.route], { unique: true })
export class CryptoInput extends IEntity {
  @Column({ length: 256 })
  inTxId: string;

  @Column({ length: 256 })
  outTxId: string;

  @Column({ length: 256, nullable: true })
  returnTxId: string;

  @Column({ type: 'integer' })
  blockHeight: number;

  @Column({ type: 'float' })
  amount: number;

  @Column({ type: 'float', nullable: true })
  btcAmount?: number;

  @Column({ type: 'float', nullable: true })
  usdtAmount?: number;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  asset: Asset;

  @Column({ length: 256, nullable: true })
  type: CryptoInputType;

  @ManyToOne(() => DepositRoute, { nullable: false })
  route: Sell | Staking;

  @Column({ default: false })
  isConfirmed: boolean;

  @Column({ length: 256, default: AmlCheck.FAIL })
  amlCheck: AmlCheck;

  @OneToOne(() => CryptoSell, (sell) => sell.cryptoInput, { nullable: true })
  cryptoSell?: CryptoSell;

  @OneToOne(() => CryptoStaking, (staking) => staking.cryptoInput, { nullable: true })
  cryptoStaking?: CryptoStaking;
}
