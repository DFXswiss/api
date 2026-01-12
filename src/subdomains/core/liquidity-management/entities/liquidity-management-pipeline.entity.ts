import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, JoinTable, ManyToOne, OneToMany } from 'typeorm';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import {
  LiquidityManagementExchanges,
  LiquidityManagementOrderStatus,
  LiquidityManagementPipelineStatus,
  LiquidityManagementSystem,
  LiquidityOptimizationType,
} from '../enums';
import { LiquidityState } from '../interfaces';
import { LiquidityManagementAction } from './liquidity-management-action.entity';
import { LiquidityManagementOrder } from './liquidity-management-order.entity';
import { LiquidityManagementRule } from './liquidity-management-rule.entity';

@Entity()
export class LiquidityManagementPipeline extends IEntity {
  @Column({ length: 256 })
  status: LiquidityManagementPipelineStatus;

  @ManyToOne(() => LiquidityManagementRule, { eager: true, nullable: false })
  @Index({
    unique: true,
    where: `status IN ('${LiquidityManagementPipelineStatus.CREATED}', '${LiquidityManagementPipelineStatus.IN_PROGRESS}')`,
  })
  rule: LiquidityManagementRule;

  @OneToMany(() => BuyCrypto, (buyCrypto) => buyCrypto.liquidityPipeline)
  buyCryptos: BuyCrypto[];

  @OneToMany(() => LiquidityManagementOrder, (orders) => orders.pipeline)
  orders: LiquidityManagementOrder[];

  @Column({ length: 256 })
  type: LiquidityOptimizationType;

  @Column({ type: 'float', nullable: true })
  minAmount?: number;

  @Column({ type: 'float', nullable: true })
  maxAmount?: number;

  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: true })
  @JoinTable()
  currentAction?: LiquidityManagementAction;

  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: true })
  @JoinTable()
  previousAction?: LiquidityManagementAction;

  @Column({ type: 'int', nullable: true })
  ordersProcessed?: number;

  //*** FACTORY METHODS ***//

  static create(rule: LiquidityManagementRule, verificationResult: LiquidityState): LiquidityManagementPipeline {
    const pipeline = new LiquidityManagementPipeline();

    pipeline.status = LiquidityManagementPipelineStatus.CREATED;
    pipeline.rule = rule;
    pipeline.ordersProcessed = 0;
    pipeline.type = verificationResult.action;
    pipeline.minAmount = verificationResult.minAmount;
    pipeline.maxAmount = verificationResult.maxAmount;

    return pipeline;
  }

  //*** GETTERS ***//

  get isDone(): boolean {
    return [
      LiquidityManagementPipelineStatus.FAILED,
      LiquidityManagementPipelineStatus.STOPPED,
      LiquidityManagementPipelineStatus.COMPLETE,
    ].includes(this.status);
  }

  get exchangeOrders(): LiquidityManagementOrder[] {
    return (
      this.orders?.filter(
        (order) =>
          LiquidityManagementExchanges.includes(order.action?.system as LiquidityManagementSystem) &&
          order.inputAsset &&
          order.outputAsset &&
          order.inputAsset !== order.outputAsset &&
          order.inputAmount > 0 &&
          order.outputAmount > 0,
      ) ?? []
    );
  }

  get subPipelineOrders(): LiquidityManagementOrder[] {
    return (
      this.orders?.filter(
        (order) =>
          order.action?.system === LiquidityManagementSystem.LIQUIDITY_PIPELINE &&
          order.correlationId &&
          order.status === LiquidityManagementOrderStatus.COMPLETE,
      ) ?? []
    );
  }

  //*** PUBLIC API ***//

  start(): this {
    this.status = LiquidityManagementPipelineStatus.IN_PROGRESS;
    this.currentAction = this.rule.getStartAction(this.type);

    return this;
  }

  continue(currentActionOrderStatus: LiquidityManagementOrderStatus): this {
    this.previousAction = Object.assign(new LiquidityManagementAction(), this.currentAction);
    this.ordersProcessed++;

    if (this.ordersProcessed >= 15) {
      this.currentAction = null;
      this.status = LiquidityManagementPipelineStatus.STOPPED;

      return this;
    }

    if (currentActionOrderStatus === LiquidityManagementOrderStatus.COMPLETE) {
      if (this.currentAction.onSuccess) {
        this.currentAction = this.currentAction.onSuccess;
      } else {
        this.currentAction = null;
        this.status = LiquidityManagementPipelineStatus.COMPLETE;
      }
    }

    if (currentActionOrderStatus === LiquidityManagementOrderStatus.NOT_PROCESSABLE) {
      if (this.currentAction.onFail) {
        this.currentAction = this.currentAction.onFail;
      } else {
        this.currentAction = null;
        this.status = LiquidityManagementPipelineStatus.FAILED;
      }
    }

    if (currentActionOrderStatus === LiquidityManagementOrderStatus.FAILED) {
      this.currentAction = null;
      this.status = LiquidityManagementPipelineStatus.FAILED;
    }

    return this;
  }
}
