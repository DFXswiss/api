import { Active } from 'src/shared/models/active';
import { IEntity } from 'src/shared/models/entity';
import { Price, PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { Column, Entity, JoinTable, ManyToOne } from 'typeorm';
import { LiquidityManagementOrderStatus } from '../enums';
import { OrderFailedException } from '../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';
import { LiquidityManagementAction } from './liquidity-management-action.entity';
import { LiquidityManagementPipeline } from './liquidity-management-pipeline.entity';

@Entity()
export class LiquidityManagementOrder extends IEntity {
  @Column({ length: 256, nullable: false })
  status: LiquidityManagementOrderStatus;

  @Column({ length: 256, nullable: true })
  priceSource?: string;

  @Column({ type: 'float', nullable: true })
  inputAmount?: number;

  @Column({ length: 256, nullable: true })
  inputAsset?: string;

  @Column({ type: 'float', nullable: true })
  amount?: number;

  @Column({ length: 256, nullable: true })
  outputAsset?: string;

  @ManyToOne(() => LiquidityManagementPipeline, (liquidityPipeline) => liquidityPipeline.buyCryptos, {
    eager: true,
    nullable: false,
  })
  @JoinTable()
  pipeline: LiquidityManagementPipeline;

  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: false })
  @JoinTable()
  action: LiquidityManagementAction;

  @Column({ type: 'int', nullable: true })
  previousOrderId?: number;

  @Column({ length: 256, nullable: true })
  correlationId?: string;

  @Column({ length: 'MAX', nullable: true })
  errorMessage?: string;

  //*** FACTORY ***//

  static create(
    amount: number,
    pipeline: LiquidityManagementPipeline,
    action: LiquidityManagementAction,
    previousOrderId: number,
  ): LiquidityManagementOrder {
    const order = new LiquidityManagementOrder();

    order.status = LiquidityManagementOrderStatus.CREATED;
    order.amount = amount;
    order.pipeline = pipeline;
    order.action = action;
    order.previousOrderId = previousOrderId;

    return order;
  }

  get exchangePrice(): Price {
    return Price.create(
      this.inputAsset,
      this.outputAsset,
      this.inputAmount / this.amount,
      undefined,
      undefined,
      PriceStep.create(this.priceSource, this.inputAsset, this.outputAsset, this.inputAmount / this.amount),
    );
  }

  get target(): Active {
    return this.pipeline.rule.targetAsset ?? this.pipeline.rule.targetFiat;
  }

  //*** PUBLIC API ***//

  inProgress(correlationId: string): this {
    this.correlationId = correlationId;
    this.status = LiquidityManagementOrderStatus.IN_PROGRESS;

    return this;
  }

  complete(): this {
    this.status = LiquidityManagementOrderStatus.COMPLETE;

    return this;
  }

  notProcessable(error: OrderNotProcessableException): this {
    this.status = LiquidityManagementOrderStatus.NOT_PROCESSABLE;
    this.errorMessage = error.message;

    return this;
  }

  fail(error: OrderFailedException): this {
    this.status = LiquidityManagementOrderStatus.FAILED;
    this.errorMessage = error.message;

    return this;
  }
}
