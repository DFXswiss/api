import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { LiquidityBalance } from './liquidity-balance.entity';
import { LiquidityManagementAction } from './liquidity-management-action.entity';
import { LiquidityManagementContext, LiquidityManagementRuleStatus, LiquidityOptimizationType } from '../enums';
import { LiquidityVerificationResult } from '../interfaces';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementRuleInitSpecification } from '../specifications/liquidity-management-rule-init.specification';

@Entity()
export class LiquidityManagementRule extends IEntity {
  @Column({ length: 256, nullable: true })
  context: LiquidityManagementContext;

  @Column({ length: 256, nullable: true })
  status: LiquidityManagementRuleStatus;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  @Index({ unique: true, where: 'targetAssetId IS NOT NULL' })
  targetAsset: Asset;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  @Index({ unique: true, where: 'targetFiatId IS NOT NULL' })
  targetFiat: Fiat;

  @Column({ type: 'float', nullable: true })
  minimal: number;

  @Column({ type: 'float', nullable: true })
  optimal: number;

  @Column({ type: 'float', nullable: true })
  maximal: number;

  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: true })
  deficitStartAction: LiquidityManagementAction;

  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: true })
  redundancyStartAction: LiquidityManagementAction;

  @Column({ type: 'int', nullable: true })
  reactivationTime: number;

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

  verify(balance: LiquidityBalance): LiquidityVerificationResult {
    const deviation = Util.round(Math.abs(this.optimal - balance.amount), 8);

    const deficit = this.minimal != null && balance.amount < this.minimal ? deviation : 0;
    const redundancy = !deficit && this.maximal != null && balance.amount > this.maximal ? deviation : 0;

    return {
      isOptimal: !(deficit || redundancy),
      liquidityDeficit: deficit,
      liquidityRedundancy: redundancy,
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
      this.status === LiquidityManagementRuleStatus.PAUSED &&
      Util.minutesDiff(this.updated, new Date()) > this.reactivationTime
    );
  }

  //*** GETTERS ***//

  getStartAction(optimizationType: LiquidityOptimizationType): LiquidityManagementAction {
    return optimizationType === LiquidityOptimizationType.DEFICIT
      ? this.deficitStartAction
      : this.redundancyStartAction;
  }

  get target(): Asset | Fiat {
    return this.targetAsset ?? this.targetFiat;
  }
}
