import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinTable, ManyToOne } from 'typeorm';
import { LiquidityManagementProcessor } from './liquidity-management-processor.entity';
import { LiquidityManagementRule } from './liquidity-management-rule.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementOrderType } from '../enums';

@Entity()
export class LiquidityManagementOrder extends IEntity {
  @Column({ length: 256, nullable: false })
  status: LiquidityManagementOrderStatus;

  @Column({ length: 256, nullable: false })
  type: LiquidityManagementOrderType;

  @Column({ type: 'float', nullable: true })
  amount: number;

  @ManyToOne(() => LiquidityManagementProcessor, { eager: true, nullable: false })
  @JoinTable()
  rule: LiquidityManagementRule;

  @ManyToOne(() => LiquidityManagementProcessor, { eager: true, nullable: false })
  @JoinTable()
  processor: LiquidityManagementProcessor;

  //*** FACTORY ***//

  static create(
    type: LiquidityManagementOrderType,
    amount: number,
    rule: LiquidityManagementRule,
    processor: LiquidityManagementProcessor,
  ): LiquidityManagementOrder {
    const entity = new LiquidityManagementOrder();

    return entity;
  }

  //*** PUBLIC API ***//

  fail(): this {
    this.status = LiquidityManagementOrderStatus.FAILED;

    return this;
  }
}
