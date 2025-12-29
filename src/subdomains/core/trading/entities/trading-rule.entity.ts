import { FeeAmount } from '@uniswap/v3-sdk';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { PriceSource } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { TradingRuleStatus } from '../enums';

export interface PriceConfig {
  source: PriceSource;
  from: string;
  to: string;
  param?: string;
}

@Entity()
export class TradingRule extends IEntity {
  @Column()
  status: TradingRuleStatus;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  leftAsset: Asset;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  rightAsset: Asset;

  // reference price
  @Column()
  source1: string; // {src}:{param}

  @Column()
  leftAsset1: string;

  @Column()
  rightAsset1: string;

  // pool price
  @Column()
  source2: string; // {src}:{param}

  @Column()
  leftAsset2: string;

  @Column()
  rightAsset2: string;

  // check price
  @Column({ nullable: true })
  source3?: string; // {src}:{param}

  @Column({ nullable: true })
  leftAsset3?: string;

  @Column({ nullable: true })
  rightAsset3?: string;

  @Column({ type: 'float' })
  lowerLimit: number;

  @Column({ type: 'float', default: 1 })
  lowerTarget: number;

  @Column({ type: 'float' })
  upperLimit: number;

  @Column({ type: 'float', default: 1 })
  upperTarget: number;

  @Column({ type: 'int', default: FeeAmount.LOWEST })
  poolFee: FeeAmount;

  @Column({ type: 'int', nullable: true })
  reactivationTime?: number;

  // --- GETTERS --- //
  get config1(): PriceConfig {
    return {
      ...this.mapSource(this.source1),
      from: this.leftAsset1,
      to: this.rightAsset1,
    };
  }

  get config2(): PriceConfig {
    return {
      ...this.mapSource(this.source2),
      from: this.leftAsset2,
      to: this.rightAsset2,
    };
  }

  get config3(): PriceConfig | undefined {
    return (
      this.source3 && {
        ...this.mapSource(this.source3),
        from: this.leftAsset3,
        to: this.rightAsset3,
      }
    );
  }

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

  // --- HELPER METHODS --- //
  private mapSource(src: string): { source: PriceSource; param?: string } {
    const [source, param] = src.split(':');
    return { source: source as PriceSource, param };
  }
}
