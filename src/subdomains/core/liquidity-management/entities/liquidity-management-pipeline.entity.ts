import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, JoinTable, ManyToOne, OneToMany } from 'typeorm';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementPipelineStatus, LiquidityOptimizationType } from '../enums';
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
  optAmount?: number;

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
    pipeline.type = this.getPipelineType(verificationResult);
    pipeline.minAmount = verificationResult.minDeficit;
    pipeline.optAmount = verificationResult.deficit || verificationResult.redundancy;

    return pipeline;
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

  //*** HELPER METHODS ***//

  private static getPipelineType(verificationResult: LiquidityState): LiquidityOptimizationType {
    const { deficit, redundancy } = verificationResult;

    if (!deficit && !redundancy) {
      throw new Error('Cannot create pipeline for optimal rule. No liquidity deficit or redundancy found');
    }

    return deficit ? LiquidityOptimizationType.DEFICIT : LiquidityOptimizationType.REDUNDANCY;
  }
}
