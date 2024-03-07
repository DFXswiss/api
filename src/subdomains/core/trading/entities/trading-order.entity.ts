import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, JoinTable, ManyToOne } from 'typeorm';
import { UniswapPoolTradingInfoDto } from '../dto/uniswap.dto';
import { TradingOrderStatus } from '../enums';
import { TradingRule } from './trading-rule.entity';

@Entity()
export class TradingOrder extends IEntity {
  @Column({ length: 256, nullable: true })
  status: TradingOrderStatus;

  @ManyToOne(() => TradingRule, { nullable: false, eager: true })
  @JoinTable()
  tradingRule: TradingRule;

  @Column({ type: 'float', nullable: false })
  price1: number;

  @Column({ type: 'float', nullable: false })
  price2: number;

  @Column({ type: 'float', nullable: false })
  priceImpact: number;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  @JoinColumn()
  assetIn: Asset;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  @JoinColumn()
  assetOut: Asset;

  @Column({ type: 'float', nullable: false })
  amountIn: number;

  @Column({ length: 256, nullable: true })
  txId: string;

  @Column({ length: 'MAX', nullable: true })
  errorMessage: string;

  //*** FACTORY ***//

  static create(tradingRule: TradingRule, tradingInfo: UniswapPoolTradingInfoDto): TradingOrder {
    const order = new TradingOrder();

    order.status = TradingOrderStatus.CREATED;
    order.tradingRule = tradingRule;
    order.price1 = tradingInfo.source1.price;
    order.price2 = tradingInfo.source2.price;
    order.priceImpact = tradingInfo.swap.priceImpact;
    order.assetIn = tradingInfo.swap.assetIn;
    order.assetOut = tradingInfo.swap.assetOut;
    order.amountIn = tradingInfo.swap.amountIn;

    return order;
  }

  //*** PUBLIC API ***//

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

  complete(): this {
    this.status = TradingOrderStatus.COMPLETE;

    return this;
  }

  fail(errorMessage: string): this {
    this.status = TradingOrderStatus.FAILED;
    this.errorMessage = errorMessage;

    return this;
  }
}
