import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
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
  targetAsset: Asset;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  targetFiat: Fiat;

  @Column({ type: 'float', nullable: true })
  minimum: number;

  @Column({ type: 'float', nullable: true })
  optimal: number;

  @Column({ type: 'float', nullable: true })
  maximum: number;

  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: true })
  deficitStartAction: LiquidityManagementAction;

  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: true })
  redundancyStartAction: LiquidityManagementAction;

  //*** FACTORY METHODS ***//

  static create(
    context: LiquidityManagementContext,
    targetAsset: Asset,
    targetFiat: Fiat,
    minimum: number,
    optimal: number,
    maximum: number,
    deficitStartAction: LiquidityManagementAction,
    redundancyStartAction: LiquidityManagementAction,
  ): LiquidityManagementRule {
    const rule = new LiquidityManagementRule();

    rule.status = LiquidityManagementRuleStatus.ACTIVE;
    rule.context = context;
    rule.targetAsset = targetAsset;
    rule.targetFiat = targetFiat;
    rule.minimum = minimum;
    rule.optimal = optimal;
    rule.maximum = maximum;
    rule.deficitStartAction = deficitStartAction;
    rule.redundancyStartAction = redundancyStartAction;

    LiquidityManagementRuleInitSpecification.isSatisfiedBy(rule);

    return rule;
  }

  //*** PUBLIC API ***//

  verify(balance: LiquidityBalance): LiquidityVerificationResult {
    const deviation = Util.round(Math.abs(this.optimal - balance.amount), 8);

    const deficit = balance.amount < this.minimum ? deviation : 0;
    const redundancy = !deficit && this.maximum && balance.amount > this.maximum ? deviation : 0;

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

  reactivate(): this {
    this.status = LiquidityManagementRuleStatus.ACTIVE;

    return this;
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
