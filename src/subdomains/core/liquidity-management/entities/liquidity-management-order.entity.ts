import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinTable, ManyToOne } from 'typeorm';
import { LiquidityManagementAction } from './liquidity-management-action.entity';
import { LiquidityManagementOrderStatus } from '../enums';
import { LiquidityManagementPipeline } from './liquidity-management-pipeline.entity';

@Entity()
export class LiquidityManagementOrder extends IEntity {
  @Column({ length: 256, nullable: false })
  status: LiquidityManagementOrderStatus;

  @Column({ type: 'float', nullable: true })
  amount: number;

  @ManyToOne(() => LiquidityManagementPipeline, { nullable: false })
  @JoinTable()
  pipeline: LiquidityManagementPipeline;

  @ManyToOne(() => LiquidityManagementAction, { nullable: false })
  @JoinTable()
  action: LiquidityManagementAction;

  //*** FACTORY ***//

  static create(
    amount: number,
    pipeline: LiquidityManagementPipeline,
    action: LiquidityManagementAction,
  ): LiquidityManagementOrder {
    const order = new LiquidityManagementOrder();

    order.status = LiquidityManagementOrderStatus.CREATED;
    order.amount = amount;
    order.pipeline = pipeline;
    order.action = action;

    return order;
  }

  //*** PUBLIC API ***//

  inProgress(): this {
    this.status = LiquidityManagementOrderStatus.IN_PROGRESS;

    return this;
  }

  complete(): this {
    this.status = LiquidityManagementOrderStatus.COMPLETE;

    return this;
  }

  fail(): this {
    this.status = LiquidityManagementOrderStatus.FAILED;

    return this;
  }
}
