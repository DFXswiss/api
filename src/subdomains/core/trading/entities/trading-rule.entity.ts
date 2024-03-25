import { FeeAmount } from '@uniswap/v3-sdk';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { PriceSource } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { TradingRuleStatus } from '../enums';

@Entity()
export class TradingRule extends IEntity {
  @Column()
  status: TradingRuleStatus;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  leftAsset: Asset;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  rightAsset: Asset;

  @Column()
  source1: PriceSource;

  @Column()
  leftAsset1: string;

  @Column()
  rightAsset1: string;

  @Column()
  source2: PriceSource;

  @Column()
  leftAsset2: string;

  @Column()
  rightAsset2: string;

  @Column({ type: 'float' })
  lowerLimit: number;

  @Column({ type: 'float' })
  upperLimit: number;

  @Column({ type: 'int', default: FeeAmount.LOWEST })
  feeAmount: FeeAmount;

  @Column({ type: 'int', nullable: true })
  reactivationTime: number;

  // --- PUBLIC API --- //

  isActive(): boolean {
    return this.status === TradingRuleStatus.ACTIVE;
  }

  isInactive(): boolean {
    return this.status === TradingRuleStatus.INACTIVE;
  }

  isProcessing(): boolean {
    return this.status === TradingRuleStatus.PROCESSING;
  }

  isPaused(): boolean {
    return this.status === TradingRuleStatus.PAUSED;
  }

  processing(): this {
    this.status = TradingRuleStatus.PROCESSING;

    return this;
  }

  deactivate(): this {
    this.status = TradingRuleStatus.INACTIVE;

    return this;
  }

  reactivate(): this {
    this.status = TradingRuleStatus.ACTIVE;

    return this;
  }

  pause(): this {
    this.status = TradingRuleStatus.PAUSED;

    return this;
  }

  shouldReactivate(): boolean {
    return (
      this.status === TradingRuleStatus.PAUSED && Util.minutesDiff(this.updated, new Date()) > this.reactivationTime
    );
  }
}
