import { Active } from 'src/shared/models/active';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, Index, JoinColumn, ManyToOne, ManyToOne as OneToOne } from 'typeorm';
import { LiquidityManagementContext, LiquidityManagementRuleStatus, LiquidityOptimizationType } from '../enums';
import { LiquidityState } from '../interfaces';
import { LiquidityManagementRuleInitSpecification } from '../specifications/liquidity-management-rule-init.specification';
import { LiquidityBalance } from './liquidity-balance.entity';
import { LiquidityManagementAction } from './liquidity-management-action.entity';

@Entity()
@Index((r: LiquidityManagementRule) => [r.context, r.targetAsset, r.targetFiat], { unique: true })
export class LiquidityManagementRule extends IEntity {
  @Column({ length: 256, nullable: true })
  context?: LiquidityManagementContext;

  @Column({ length: 256, nullable: true })
  status?: LiquidityManagementRuleStatus;

  @OneToOne(() => Asset, { eager: true, nullable: true })
  @JoinColumn()
  targetAsset?: Asset;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  targetFiat?: Fiat;

  @Column({ type: 'float', nullable: true })
  minimal?: number;

  @Column({ type: 'float', nullable: true })
  optimal?: number;

  @Column({ type: 'float', nullable: true })
  maximal?: number;

  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: true })
  deficitStartAction?: LiquidityManagementAction;

  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: true })
  redundancyStartAction?: LiquidityManagementAction;

  @Column({ type: 'int', nullable: true })
  reactivationTime?: number;

  @Column({ default: true })
  sendNotifications: boolean;

  //*** FACTORY METHODS ***//

  static create(
    context: LiquidityManagementContext,
    targetAsset: Asset,
    targetFiat: Fiat,
    minimal: number,
    optimal: number,
    maximal: number,
    deficitStartAction: LiquidityManagementAction,
    redundancyStartAction: LiquidityManagementAction,
    reactivationTime: number,
  ): LiquidityManagementRule {
    const rule = new LiquidityManagementRule();

    rule.status = LiquidityManagementRuleStatus.ACTIVE;
    rule.context = context;
    rule.targetAsset = targetAsset;
    rule.targetFiat = targetFiat;
    rule.minimal = minimal;
    rule.optimal = optimal;
    rule.maximal = maximal;
    rule.deficitStartAction = deficitStartAction;
    rule.redundancyStartAction = redundancyStartAction;
    rule.reactivationTime = reactivationTime;

    LiquidityManagementRuleInitSpecification.isSatisfiedBy(rule);

    return rule;
  }

  //*** PUBLIC API ***//

  verify(balance: LiquidityBalance): LiquidityState {
    const deviation = Util.round(Math.abs(this.optimal - balance.amount), 8);

    const deficit = this.minimal != null && balance.amount < this.minimal ? deviation : 0;
    const redundancy = !deficit && this.maximal != null && balance.amount > this.maximal ? deviation : 0;

    return {
      minDeficit: deficit,
      deficit,
      redundancy,
    };
  }

  processing(): this {
    this.status = LiquidityManagementRuleStatus.PROCESSING;
    return this;
  }

  deactivate(): this {
    this.status = LiquidityManagementRuleStatus.INACTIVE;

    return this;
  }

  pause(): this {
    this.status = LiquidityManagementRuleStatus.PAUSED;

    return this;
  }

  reactivate(): this {
    this.status = LiquidityManagementRuleStatus.ACTIVE;

    return this;
  }

  updateRuleSettings(reactivationTime: number | undefined): this {
    if (reactivationTime !== undefined) this.reactivationTime = reactivationTime;

    return this;
  }

  shouldReactivate(): boolean {
    return (
      this.status === LiquidityManagementRuleStatus.PAUSED && Util.minutesDiff(this.updated) > this.reactivationTime
    );
  }

  //*** GETTERS ***//

  getStartAction(optimizationType: LiquidityOptimizationType): LiquidityManagementAction {
    return optimizationType === LiquidityOptimizationType.DEFICIT
      ? this.deficitStartAction
      : this.redundancyStartAction;
  }

  get target(): Active {
    return this.targetAsset ?? this.targetFiat;
  }

  get targetName(): string {
    return this.targetAsset?.uniqueName ?? this.targetFiat.name;
  }
}
