import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { TradingInfo } from '../dto/trading.dto';
import { TradingOrderStatus } from '../enums';
import { TradingRule } from './trading-rule.entity';

@Entity()
export class TradingOrder extends IEntity {
  @Column()
  status: TradingOrderStatus;

  @ManyToOne(() => TradingRule, { nullable: false, eager: true })
  tradingRule: TradingRule;

  @Column({ type: 'float' })
  price1: number; // target price

  @Column({ type: 'float' })
  price2: number; // current price

  @Column({ type: 'float', nullable: true })
  price3?: number; // check price

  @Column({ type: 'float' })
  priceImpact: number;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  assetIn: Asset;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  assetOut: Asset;

  @Column({ type: 'float', nullable: true })
  amountIn?: number;

  @Column({ type: 'float', nullable: true })
  amountExpected?: number;

  @Column({ type: 'float', nullable: true })
  amountOut?: number;

  @Column({ nullable: true })
  txId?: string;

  @Column({ type: 'float', nullable: true })
  txFeeAmount?: number;

  @Column({ type: 'float', nullable: true })
  txFeeAmountChf?: number;

  @Column({ type: 'float', nullable: true })
  swapFeeAmount?: number;

  @Column({ type: 'float', nullable: true })
  swapFeeAmountChf?: number;

  @Column({ length: 'MAX', nullable: true })
  errorMessage?: string;

  @Column({ type: 'float', nullable: true })
  profitChf?: number;

  // --- FACTORY --- //

  static create(tradingRule: TradingRule, tradingInfo: TradingInfo): TradingOrder {
    const order = new TradingOrder();

    order.status = tradingInfo.tradeRequired ? TradingOrderStatus.CREATED : TradingOrderStatus.IGNORED;
    order.tradingRule = tradingRule;
    order.price1 = tradingInfo.price1;
    order.price2 = tradingInfo.price2;
    order.price3 = tradingInfo.price3;
    order.priceImpact = tradingInfo.priceImpact;
    order.assetIn = tradingInfo.assetIn;
    order.assetOut = tradingInfo.assetOut;
    order.amountIn = tradingInfo.amountIn;
    order.amountExpected = tradingInfo.amountExpected;
    order.errorMessage = tradingInfo.message;

    return order;
  }

  // --- PUBLIC API --- //

  isCreated(): boolean {
    return this.status === TradingOrderStatus.CREATED;
  }

  isInProgress(): boolean {
    return this.status === TradingOrderStatus.IN_PROGRESS;
  }

  isComplete(): boolean {
    return this.status === TradingOrderStatus.COMPLETE;
  }

  isFailed(): boolean {
    return this.status === TradingOrderStatus.FAILED;
  }

  inProgress(): this {
    this.status = TradingOrderStatus.IN_PROGRESS;

    return this;
  }

  complete(
    outputAmount: number,
    txFeeAmount: number,
    txFeeAmountChf: number,
    swapFeeAmount: number,
    swapFeeAmountChf: number,
    profitChf: number,
  ): this {
    this.amountOut = outputAmount;
    this.txFeeAmount = txFeeAmount;
    this.txFeeAmountChf = txFeeAmountChf;
    this.swapFeeAmount = swapFeeAmount;
    this.swapFeeAmountChf = swapFeeAmountChf;
    this.profitChf = profitChf;

    this.status = TradingOrderStatus.COMPLETE;

    return this;
  }

  fail(errorMessage: string): this {
    this.status = TradingOrderStatus.FAILED;
    this.errorMessage = errorMessage;

    return this;
  }

  get feeAmountChf(): number {
    return this.txFeeAmountChf;
  }
}
