import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Column, Entity, JoinTable, ManyToMany } from 'typeorm';
import { LiquidityBalance } from './liquidity-balance.entity';
import { LiquidityManagementAction } from './liquidity-management-action.entity';
import { LiquidityManagementContext, LiquidityManagementRuleStatus, LiquidityOptimizationType } from '../enums';
import { LiquidityVerificationResult } from '../interfaces';
import { Util } from 'src/shared/utils/util';

@Entity()
export class LiquidityManagementRule extends IEntity {
  @Column({ length: 256, nullable: true })
  context: LiquidityManagementContext;

  @Column({ length: 256, nullable: true })
  status: LiquidityManagementRuleStatus;

  @Column({ length: 256, nullable: true })
  targetAsset: Asset;

  @Column({ length: 256, nullable: true })
  targetFiat: Fiat;

  @Column({ type: 'float', nullable: true })
  minimal: number;

  @Column({ type: 'float', nullable: true })
  optimal: number;

  @Column({ type: 'float', nullable: true })
  maximum: number;

  @ManyToMany(() => LiquidityManagementAction)
  @JoinTable()
  deficitActions: LiquidityManagementAction[];

  @ManyToMany(() => LiquidityManagementAction)
  @JoinTable()
  redundancyActions: LiquidityManagementAction[];

  //*** FACTORY METHODS ***//

  static create(): LiquidityManagementRule {
    // allow only Asset or Fiat, not both

    const entity = new LiquidityManagementRule();

    return entity;
  }

  //*** PUBLIC API ***//

  verify(balance: LiquidityBalance): LiquidityVerificationResult {
    const deviation = Util.round(Math.abs(this.optimal - balance.amount), 8);

    const deficit = balance.amount < this.minimal ? deviation : 0;
    const redundancy = !deficit && balance.amount > this.maximum ? deviation : 0;

    return {
      isOptimal: !(deficit || redundancy),
      liquidityDeficit: deficit,
      liquidityRedundancy: redundancy,
    };
  }

  //*** GETTERS ***//

  getActions(optimizationType: LiquidityOptimizationType): LiquidityManagementAction[] {
    return optimizationType === LiquidityOptimizationType.DEFICIT ? this.deficitActions : this.redundancyActions;
  }

  get target(): Asset | Fiat {
    return this.targetAsset ?? this.targetFiat;
  }
}
