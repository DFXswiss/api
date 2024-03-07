import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { PriceSource } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { TradingRuleStatus } from '../enums';

@Entity()
export class TradingRule extends IEntity {
  @Column({ length: 256, nullable: true })
  status: TradingRuleStatus;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  @JoinColumn()
  leftAsset: Asset;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  @JoinColumn()
  rightAsset: Asset;

  @Column({ nullable: false })
  source1: PriceSource;

  @Column({ nullable: false })
  leftAsset1: string;

  @Column({ nullable: false })
  rightAsset1: string;

  @Column({ nullable: false })
  source2: PriceSource;

  @Column({ nullable: false })
  leftAsset2: string;

  @Column({ nullable: false })
  rightAsset2: string;

  @Column({ type: 'float', nullable: false })
  lowerLimit: number;

  @Column({ type: 'float', nullable: false })
  upperLimit: number;

  @Column({ type: 'int', nullable: true })
  reactivationTime: number;

  //*** PUBLIC API ***//

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

  updateRuleSettings(reactivationTime: number | undefined): this {
    if (reactivationTime !== undefined) this.reactivationTime = reactivationTime;

    return this;
  }

  shouldReactivate(): boolean {
    return (
      this.status === TradingRuleStatus.PAUSED && Util.minutesDiff(this.updated, new Date()) > this.reactivationTime
    );
  }
}
