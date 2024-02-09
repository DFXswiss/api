import { BadRequestException } from '@nestjs/common';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { FeeRequest } from '../services/fee.service';

export enum FeeType {
  BASE = 'Base',
  DISCOUNT = 'Discount',
  ADDITION = 'Addition',
  CUSTOM = 'Custom',
}

@Entity()
export class Fee extends IEntity {
  @Column({ length: 256 })
  label: string;

  @Column({ length: 256 })
  type: FeeType;

  @Column({ type: 'float' })
  rate: number;

  @Column({ type: 'float', default: 0 })
  fixed: number; // EUR

  @Column({ type: 'float', default: 1 })
  blockchainFactor: number;

  @Column({ default: true })
  payoutRefBonus: boolean;

  @Column({ default: true })
  active: boolean;

  // Filter columns
  @Column({ length: 256, nullable: true })
  discountCode: string;

  @Column({ length: 256, nullable: true })
  accountType: AccountType;

  @Column({ length: 'MAX', nullable: true })
  paymentMethodsIn: string;

  @Column({ length: 'MAX', nullable: true })
  paymentMethodsOut: string;

  @Column({ type: 'datetime2', nullable: true })
  expiryDate: Date;

  @Column({ length: 'MAX', nullable: true })
  assets: string; // semicolon separated id's

  @ManyToOne(() => Wallet, { nullable: true, eager: true })
  wallet: Wallet;

  // Volume columns

  @Column({ type: 'float', nullable: true })
  minTxVolume: number; // EUR

  @Column({ type: 'float', nullable: true })
  maxTxVolume: number; // EUR

  @Column({ type: 'float', nullable: true })
  maxAnnualUserTxVolume: number; // EUR

  @Column({ length: 'MAX', nullable: true })
  annualUserTxVolumes: string;

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

    const userTxUsages = this.getUserTxUsages();
    userTxUsages[userDataId] = (userTxUsages[userDataId] ?? 0) + 1;
    this.setUserTxUsages(userTxUsages);

    return [this.id, { userTxUsages: this.userTxUsages }];
  }

  increaseAnnualUserTxVolume(userDataId: number, txVolume: number): UpdateResult<Fee> {
    if (this.isExpired(userDataId) || !this.active)
      throw new BadRequestException('Fee is expired - increaseUserTxUsage forbidden');

    const annualUserTxVolumes = this.getAnnualUserTxVolumes();
    annualUserTxVolumes[userDataId] = (annualUserTxVolumes[userDataId] ?? 0) + txVolume;
    this.setAnnualUserTxVolumes(annualUserTxVolumes);

    return [this.id, { annualUserTxVolumes: this.annualUserTxVolumes }];
  }

  verifyForTx(request: FeeRequest): boolean {
    const annualUserTxVolume = this.getAnnualUserTxVolume(request.userDataId) + (request.txVolume ?? 0);

    return (
      this?.active &&
      !(
        this.isExpired(request.userDataId) ||
        (this.accountType && this.accountType !== request.accountType) ||
        (this.wallet && this.wallet.id !== request.wallet?.id) ||
        (this.paymentMethodsIn && !this.paymentMethodsIn.includes(request.paymentMethodIn)) ||
        (this.paymentMethodsOut && !this.paymentMethodsOut.includes(request.paymentMethodOut)) ||
        (this.assetList?.length && !this.assetList.includes(request.asset?.id)) ||
        (this.maxTxVolume && this.maxTxVolume < request.txVolume) ||
        (this.minTxVolume && this.minTxVolume > request.txVolume) ||
        (this.maxAnnualUserTxVolume && this.maxAnnualUserTxVolume < annualUserTxVolume)
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

  //*** GETTER METHODS ***//

  get assetList(): number[] {
    return this.assets?.split(';')?.map(Number);
  }

  //*** HELPER METHODS ***//

  private getUserTxUsages(): Record<number, number> {
    return (
      this.userTxUsages
        ?.split(';')
        .map((u) => u.split(':'))
        .reduce((prev, [id, usages]) => {
          prev[+id] = +usages;
          return prev;
        }, {}) ?? {}
    );
  }

  private setUserTxUsages(usages: Record<number, number>): void {
    this.userTxUsages = Object.entries(usages)
      .map(([userDataId, usages]) => `${userDataId}:${usages}`)
      .join(';');
  }

  private getUserTxUsage(userDataId: number): number {
    return this.getUserTxUsages()[userDataId] ?? 0;
  }

  private getAnnualUserTxVolumes(): Record<number, number> {
    return (
      this.annualUserTxVolumes
        ?.split(';')
        .map((u) => u.split(':'))
        .reduce((prev, [id, volume]) => {
          prev[+id] = +volume;
          return prev;
        }, {}) ?? {}
    );
  }

  private setAnnualUserTxVolumes(volumes: Record<number, number>): void {
    this.annualUserTxVolumes = Object.entries(volumes)
      .map(([userDataId, volume]) => `${userDataId}:${volume}`)
      .join(';');
  }

  private getAnnualUserTxVolume(userDataId: number): number {
    return this.getAnnualUserTxVolumes()[userDataId] ?? 0;
  }
}
