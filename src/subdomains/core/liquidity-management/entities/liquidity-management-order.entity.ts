import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinTable, ManyToOne, OneToOne } from 'typeorm';
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

  @OneToOne(() => LiquidityManagementOrder, { eager: true, nullable: true })
  previousOrder: LiquidityManagementOrder;

  @Column({ length: 256, nullable: true })
  correlationId: string;

  @Column({ length: 'MAX', nullable: true })
  errorMessage: string;

  //*** FACTORY ***//

  static create(
    amount: number,
    pipeline: LiquidityManagementPipeline,
    action: LiquidityManagementAction,
    previousOrder: LiquidityManagementOrder,
  ): LiquidityManagementOrder {
    const order = new LiquidityManagementOrder();

    order.status = LiquidityManagementOrderStatus.CREATED;
    order.amount = amount;
    order.pipeline = pipeline;
    order.action = action;
    order.previousOrder = previousOrder;

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
