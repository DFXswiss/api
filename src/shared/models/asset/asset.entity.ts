import { Blockchain, TestnetBlockchains } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { AmlRule } from 'src/subdomains/core/aml/enums/aml-rule.enum';
import { LiquidityBalance } from 'src/subdomains/core/liquidity-management/entities/liquidity-balance.entity';
import { LiquidityManagementRule } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-rule.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { AssetPrice } from 'src/subdomains/supporting/pricing/domain/entities/asset-price.entity';
import { PriceRule } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { Column, Entity, Index, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { IEntity, UpdateResult } from '../entity';

export enum AssetType {
  COIN = 'Coin',
  TOKEN = 'Token',
  CUSTOM = 'Custom',
  CUSTODY = 'Custody',
  POOL = 'Pool',
  PRESALE = 'Presale',
}

export enum AssetCategory {
  PUBLIC = 'Public',
  PRIVATE = 'Private',
}

@Entity()
@Index((asset: Asset) => [asset.dexName, asset.type, asset.blockchain], { unique: true })
export class Asset extends IEntity {
  @Column({ nullable: true })
  chainId?: string;

  @Column({ type: 'int', nullable: true })
  decimals?: number;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 256 })
  uniqueName: string;

  @Column({ length: 256, nullable: true })
  description?: string;

  @Column({ length: 256 })
  type: AssetType;

  @Column({ length: 256, default: AssetCategory.PUBLIC })
  category: AssetCategory;

  @Column({ nullable: true, length: 256 })
  sellCommand?: string;

  @Column({ nullable: true, length: 256 })
  dexName?: string;

  @Column({ default: true })
  buyable: boolean;

  @Column({ default: true })
  sellable: boolean;

  @Column({ default: true })
  cardBuyable: boolean;

  @Column({ default: true })
  cardSellable: boolean;

  @Column({ default: true })
  instantBuyable: boolean;

  @Column({ default: true })
  instantSellable: boolean;

  @Column({ default: false })
  paymentEnabled: boolean;

  @Column({ default: false })
  refEnabled: boolean;

  @Column({ default: true })
  refundEnabled: boolean;

  @Column({ default: false })
  ikna: boolean;

  @Column({ default: false })
  personalIbanEnabled: boolean;

  @Column({ length: 256, default: Blockchain.BITCOIN })
  blockchain: Blockchain;

  @Column({ default: false })
  comingSoon: boolean;

  @Column({ nullable: true })
  sortOrder?: number;

  @Column({ type: 'float', nullable: true })
  approxPriceUsd?: number;

  @Column({ type: 'float', nullable: true })
  approxPriceChf?: number;

  @Column({ type: 'float', nullable: true })
  approxPriceEur?: number;

  @Column({ length: 256, nullable: true })
  financialType?: string;

  @Column({ default: AmlRule.DEFAULT })
  amlRuleFrom: AmlRule;

  @Column({ default: AmlRule.DEFAULT })
  amlRuleTo: AmlRule;

  @OneToOne(() => LiquidityManagementRule, (lmr) => lmr.targetAsset)
  liquidityManagementRule: LiquidityManagementRule;

  @OneToOne(() => Bank, (bank) => bank.asset)
  bank?: Bank;

  @OneToOne(() => LiquidityBalance, (b) => b.asset)
  balance?: LiquidityBalance;

  @OneToMany(() => AssetPrice, (assetPrice) => assetPrice.asset)
  prices: AssetPrice[];

  @ManyToOne(() => PriceRule)
  priceRule: PriceRule;

  // prices outside these rails are corrupted data (e.g. from a degenerate DEX quote), not real prices
  static readonly MIN_SANE_PRICE = 1e-12;
  static readonly MAX_SANE_PRICE = 1e15;

  static isSanePrice(price?: number): boolean {
    return price != null && Number.isFinite(price) && price > Asset.MIN_SANE_PRICE && price < Asset.MAX_SANE_PRICE;
  }

  get minimalPriceReferenceAmount() {
    return Asset.isSanePrice(this.approxPriceChf) ? 1 / this.approxPriceChf : 1;
  }

  get evmChainId(): number | undefined {
    return EvmUtil.getChainId(this.blockchain);
  }

  isBuyableOn(blockchains: Blockchain[]): boolean {
    return blockchains.includes(this.blockchain) || this.type === AssetType.CUSTOM;
  }

  /**
   * Whether `other` holds the same coin as this asset — the same good, sitting somewhere else.
   *
   * A coin has one row per place it can be held: the payout wallet's `Monero/XMR` and a trading
   * venue's `MEXC/XMR` or `Kraken/XMR` are three rows and one coin. `name` is the column that
   * groups them, and the alternatives are all wrong for it:
   * - `uniqueName` encodes the place, so it can never group two places;
   * - `dexName` additionally pulls in wrapped representations that are NOT the same good — a
   *   DeFiChain `dBTC` row carries `dexName = 'BTC'`, and a whole family follows that pattern;
   * - `id` is the place, which is exactly what this method has to look past.
   *
   * The table's uniqueness contract is `(dexName, type, blockchain)`, so `name` is a semantic
   * grouping and not a key — which is why it is stated here once instead of being re-derived by
   * every query that needs it.
   *
   * Testnets are held apart because they reuse mainnet tickers verbatim while carrying no value;
   * without that, something waiting on a test network would speak for its mainnet namesake.
   *
   * Known imprecision, accepted: `BinanceSmartChain/ETHB` carries `name = 'ETH'` and is therefore
   * grouped with ETH. Binance-peg ETH is economically the same coin, operationally not
   * interchangeable with it.
   */
  isSameCoinAs(other: Asset): boolean {
    return this.name === other.name && this.isTestnetAsset === other.isTestnetAsset;
  }

  private get isTestnetAsset(): boolean {
    return TestnetBlockchains.includes(this.blockchain);
  }

  get isActive(): boolean {
    return (
      this.buyable ||
      this.cardBuyable ||
      this.instantBuyable ||
      this.sellable ||
      this.cardSellable ||
      this.instantSellable ||
      this.paymentEnabled ||
      this.refEnabled
    );
  }

  get liquidityCapacity(): number {
    return (this.liquidityManagementRule?.limit ?? Infinity) - (this.balance?.amount ?? 0);
  }

  updatePrice(usdPrice: number, chfPrice: number, eurPrice: number): UpdateResult<Asset> {
    const update: Partial<Asset> = {
      approxPriceUsd: usdPrice,
      approxPriceChf: chfPrice,
      approxPriceEur: eurPrice,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
