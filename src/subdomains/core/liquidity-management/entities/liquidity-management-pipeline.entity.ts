import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinTable, ManyToOne } from 'typeorm';
import { LiquidityManagementRule } from './liquidity-management-rule.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementPipelineStatus, LiquidityOptimizationType } from '../enums';
import { LiquidityVerificationResult } from '../interfaces';
import { LiquidityManagementAction } from './liquidity-management-action.entity';

@Entity()
export class LiquidityManagementPipeline extends IEntity {
  @Column({ length: 256, nullable: false })
  status: LiquidityManagementPipelineStatus;

  @ManyToOne(() => LiquidityManagementRule, { eager: true, nullable: false })
  rule: LiquidityManagementRule;

  @Column({ length: 256, nullable: false })
  type: LiquidityOptimizationType;

  @Column({ type: 'float', nullable: true })
  targetAmount: number;

  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: true })
  @JoinTable()
  currentAction: LiquidityManagementAction;

  @Column({ type: 'int', nullable: true })
  ordersProcessed: number;

  //*** FACTORY METHODS ***//

  static create(
    rule: LiquidityManagementRule,
    verificationResult: LiquidityVerificationResult,
  ): LiquidityManagementPipeline {
    const pipeline = new LiquidityManagementPipeline();

    pipeline.status = LiquidityManagementPipelineStatus.CREATED;
    pipeline.rule = rule;
    pipeline.ordersProcessed = 0;
    pipeline.type = this.getPipelineType(verificationResult);
    pipeline.targetAmount = verificationResult.liquidityDeficit || verificationResult.liquidityRedundancy;

    return pipeline;
  }

  //*** PUBLIC API ***//

  start(): this {
    this.status = LiquidityManagementPipelineStatus.IN_PROGRESS;
    this.currentAction = this.rule.getStartAction(this.type);

    return this;
  }

  continue(currentActionOrderStatus: LiquidityManagementOrderStatus): this {
    this.ordersProcessed++;

    if (this.ordersProcessed >= 50) {
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

    if (currentActionOrderStatus === LiquidityManagementOrderStatus.FAILED) {
      if (this.currentAction.onFail) {
        this.currentAction = this.currentAction.onFail;
      } else {
        this.currentAction = null;
        this.status = LiquidityManagementPipelineStatus.FAILED;
      }
    }

    return this;
  }

  //*** HELPER METHODS ***//

  private static getPipelineType(verificationResult: LiquidityVerificationResult): LiquidityOptimizationType {
    const { liquidityDeficit, liquidityRedundancy: liquiditySurplus, isOptimal } = verificationResult;

    if (isOptimal || (!liquidityDeficit && !liquiditySurplus)) {
      throw new Error('Cannot create pipeline for optimal rule. No liquidity deficit or redundancy found');
    }

    return liquidityDeficit ? LiquidityOptimizationType.DEFICIT : LiquidityOptimizationType.REDUNDANCY;
  }
}
