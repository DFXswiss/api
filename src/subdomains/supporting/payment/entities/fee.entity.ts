import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { FeeDirectionType } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index } from 'typeorm';

export enum FeeType {
  BASE = 'Base',
  DISCOUNT = 'Discount',
  CUSTOM = 'Custom',
}

@Entity()
@Index((fee: Fee) => [fee.label, fee.direction], { unique: true })
export class Fee extends IEntity {
  @Column({ length: 256 })
  label: string;

  @Column({ length: 256 })
  type: FeeType;

  @Column({ type: 'float' })
  rate: number;

  @Column({ type: 'float', default: 0 })
  fixed: number; // EUR

  @Column({ default: true })
  payoutRefBonus: boolean;

  @Column({ default: true })
  active: boolean;

  // Filter columns
  @Column({ length: 256, nullable: true })
  discountCode: string;

  @Column({ length: 256, nullable: true })
  accountType: AccountType;

  @Column({ length: 256, nullable: true })
  direction: FeeDirectionType;

  @Column({ type: 'datetime2', nullable: true })
  expiryDate: Date;

  @Column({ type: 'float', nullable: true })
  maxTxVolume: number; // EUR

  @Column({ length: 'MAX', nullable: true })
  assets: string; // semicolon separated id's

  // Acceptance columns

  @Column({ type: 'integer', nullable: true })
  maxUsages: number;

  @Column({ type: 'integer', default: 0 })
  usages: number;

  @Column({ type: 'integer', nullable: true })
  maxTxUsages: number;

  @Column({ type: 'integer', default: 0 })
  txUsages: number;

  //*** FACTORY METHODS ***//

  increaseUsage(): UpdateResult<Fee> {
    const update: Partial<Fee> = {
      usages: this.usages++,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  increaseTxUsage(): UpdateResult<Fee> {
    const update: Partial<Fee> = {
      txUsages: this.txUsages++,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get assetList(): number[] {
    return this.assets?.split(';')?.map(Number);
  }
}
