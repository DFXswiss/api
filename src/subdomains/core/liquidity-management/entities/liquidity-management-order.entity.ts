import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinTable, ManyToOne } from 'typeorm';
import { LiquidityManagementAction } from './liquidity-management-action.entity';
import { LiquidityManagementOrderStatus } from '../enums';
import { LiquidityManagementPipeline } from './liquidity-management-pipeline.entity';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';

@Entity()
export class LiquidityManagementOrder extends IEntity {
  @Column({ length: 256, nullable: false })
  status: LiquidityManagementOrderStatus;

  @Column({ type: 'float', nullable: true })
  amount: number;

  @ManyToOne(() => LiquidityManagementPipeline, { eager: true, nullable: false })
  @JoinTable()
  pipeline: LiquidityManagementPipeline;

  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: false })
  @JoinTable()
  action: LiquidityManagementAction;

  @Column({ type: 'int', nullable: true })
  previousOrderId: number;

  @Column({ length: 256, nullable: true })
  correlationId: string;

  @Column({ length: 'MAX', nullable: true })
  errorMessage: string;

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

  fail(error: OrderNotProcessableException): this {
    this.status = LiquidityManagementOrderStatus.FAILED;
    this.errorMessage = error.message;

    return this;
  }
}
