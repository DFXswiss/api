import { BadRequestException } from '@nestjs/common';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { FeeDirectionType } from 'src/subdomains/generic/user/models/user/user.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { FeeRequest } from '../services/fee.service';

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
  minTxVolume: number; // EUR

  @Column({ type: 'float', nullable: true })
  maxTxVolume: number; // EUR

  @Column({ length: 'MAX', nullable: true })
  assets: string; // semicolon separated id's

  @ManyToOne(() => Wallet, { nullable: true, eager: true })
  wallet: Wallet;

  // Acceptance columns

  @Column({ type: 'integer', nullable: true })
  maxUsages: number;

  @Column({ type: 'integer', default: 0 })
  usages: number;

  @Column({ type: 'integer', nullable: true })
  maxTxUsages: number;

  @Column({ type: 'integer', default: 0 })
  txUsages: number;

  @Column({ type: 'integer', nullable: true })
  maxUserTxUsages: number;

  @Column({ length: 'MAX', nullable: true })
  userTxUsages: string;

  //*** FACTORY METHODS ***//

  getUserTxUsage(userDataId: number): number {
    const userTxUsage = this.userTxUsages?.split(';').find((userTxUsage) => +userTxUsage?.split(':')[0] === userDataId);

    return +userTxUsage?.split(':')[1] ?? 0;
  }

  increaseUsage(accountType: AccountType, wallet?: Wallet): UpdateResult<Fee> {
    this.verifyForUser(accountType, wallet);

    const update: Partial<Fee> = {
      usages: this.usages + 1,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  increaseTxUsage(): UpdateResult<Fee> {
    if (this.isExpired() || !this.active) throw new BadRequestException('Fee is expired - increaseTxUsage forbidden');

    const update: Partial<Fee> = {
      txUsages: this.txUsages + 1,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  increaseUserTxUsage(userDataId: number): UpdateResult<Fee> {
    if (this.isExpired(userDataId) || !this.active)
      throw new BadRequestException('Fee is expired - increaseUserTxUsage forbidden');

    const oldUserTxUsage = this.userTxUsages
      ?.split(';')
      .find((userTxUsage) => +userTxUsage?.split(':')[0] === userDataId);

    const newUserTxUsage = `${oldUserTxUsage?.split(':')[0] ?? userDataId}:${
      +(oldUserTxUsage?.split(':')[1] ?? 0) + 1
    }`;

    const update: Partial<Fee> = {
      userTxUsages:
        !oldUserTxUsage && this.userTxUsages
          ? `${this.userTxUsages};${newUserTxUsage}`
          : this.userTxUsages?.replace(new RegExp(`\\b${oldUserTxUsage}\\b`, 'g'), newUserTxUsage) ?? newUserTxUsage,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  verifyForTx(request: FeeRequest): boolean {
    return (
      this?.active &&
      !(
        this.isExpired(request.userDataId) ||
        (this.accountType && this.accountType !== request.accountType) ||
        (this.wallet && this.wallet.id !== request.wallet?.id) ||
        (this.direction && this.direction !== request.direction) ||
        (this.assetList?.length && !this.assetList.includes(request.asset?.id)) ||
        (this.maxTxVolume && this.maxTxVolume < request.txVolume) ||
        (this.minTxVolume && this.minTxVolume > request.txVolume)
      )
    );
  }

  isExpired(userDataId?: number): boolean {
    const userTxUsage = this.getUserTxUsage(userDataId);

    return (
      !this ||
      (this.expiryDate && this.expiryDate < new Date()) ||
      (this.maxTxUsages && this.txUsages >= this.maxTxUsages) ||
      (this.maxUserTxUsages && userTxUsage >= this.maxUserTxUsages)
    );
  }

  verifyForUser(accountType: AccountType, wallet?: Wallet): void {
    if (this.isExpired()) throw new BadRequestException('Discount code is expired');
    if (this.accountType && this.accountType !== accountType)
      throw new BadRequestException('Account Type not matching');
    if (this.wallet && wallet && this.wallet.id !== wallet.id) throw new BadRequestException('Wallet not matching');

    if (this.maxUsages && this.usages >= this.maxUsages)
      throw new BadRequestException('Max usages for discount code taken');
  }

  get assetList(): number[] {
    return this.assets?.split(';')?.map(Number);
  }
}
