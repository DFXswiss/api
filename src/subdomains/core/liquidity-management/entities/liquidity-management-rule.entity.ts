import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Column, Entity, JoinTable, ManyToMany } from 'typeorm';
import { LiquidityBalance } from './liquidity-balance.entity';
import { LiquidityManagementProcessor } from './liquidity-management-processor.entity';
import { LiquidityManagementContext } from '../enums';
import { LiquidityVerificationResult } from '../interfaces';

@Entity()
export class LiquidityManagementRule extends IEntity {
  @Column({ length: 256, nullable: true })
  context: LiquidityManagementContext;

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

  // ADD MINIMAL DEVIATION

  @ManyToMany(() => LiquidityManagementProcessor)
  @JoinTable()
  processors: LiquidityManagementProcessor[];

  //*** FACTORY METHODS ***//

  static create(): LiquidityManagementRule {
    // allow only Asset or Fiat, not both

    const entity = new LiquidityManagementRule();

    return entity;
  }

  //*** PUBLIC API ***//

  verify(balance: LiquidityBalance): LiquidityVerificationResult {}

  //*** GETTERS ***//

  get target(): Asset | Fiat {
    return this.targetAsset ?? this.targetFiat;
  }
}
