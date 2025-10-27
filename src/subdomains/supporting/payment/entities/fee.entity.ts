import { BadRequestException } from '@nestjs/common';
import { isAsset, isFiat } from 'src/shared/models/active';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { Bank } from '../../bank/bank/bank.entity';
import { FeeRequest } from '../services/fee.service';

export enum FeeType {
  SPECIAL = 'Special', // Single use only, highest prio applies to all
  CUSTOM = 'Custom', // Single use only, second highest prio
  BASE = 'Base', // Single use only, absolute base fee
  DISCOUNT = 'Discount', // Single use only, absolute discount
  RELATIVE_DISCOUNT = 'RelativeDiscount', // Single use only, relative discount
  ADDITION = 'Addition', // Multiple use possible, additive fee
  CHARGEBACK_BASE = 'ChargebackBase', // Single use only, absolute base fee
  CHARGEBACK_SPECIAL = 'ChargebackSpecial', // Single use only, highest prio applies to all
  CHARGEBACK_CUSTOM = 'ChargebackCustom', // Single use only, second highest prio
  CHARGEBACK_ADDITION = 'ChargebackAddition', // Multiple use possible, additive fee
  CHARGEBACK_BANK = 'ChargebackBank', // Bank fee for chargebacks, multiple use possible, additive fee
  BANK = 'Bank', // Multiple use possible, additive fee
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
  fixed: number; // CHF

  @Column({ type: 'float', default: 1 })
  blockchainFactor: number;

  @Column({ default: true })
  payoutRefBonus: boolean;

  @Column({ default: true })
  active: boolean;

  // Filter columns
  @Column({ length: 256, nullable: true })
  specialCode?: string;

  @Column({ length: 256, nullable: true })
  accountType?: AccountType;

  @Column({ length: 'MAX', nullable: true })
  paymentMethodsIn?: string; // semicolon separated payment-methods

  @Column({ length: 'MAX', nullable: true })
  paymentMethodsOut?: string; // semicolon separated payment-methods

  @Column({ type: 'datetime2', nullable: true })
  expiryDate?: Date;

  @Column({ length: 'MAX', nullable: true })
  assets?: string; // semicolon separated id's

  @Column({ length: 'MAX', nullable: true })
  excludedAssets?: string; // semicolon separated id's

  @Column({ length: 'MAX', nullable: true })
  fiats?: string; // semicolon separated id's

  @Column({ length: 'MAX', nullable: true })
  excludedUserDatas?: string; // semicolon separated id's

  @Column({ length: 'MAX', nullable: true })
  financialTypes?: string; // semicolon separated financialTypes

  @ManyToOne(() => Wallet, { nullable: true, eager: true })
  wallet?: Wallet;

  @ManyToOne(() => Bank, { nullable: true, eager: true })
  bank?: Bank;

  // Volume columns

  @Column({ type: 'float', nullable: true })
  minTxVolume?: number; // CHF

  @Column({ type: 'float', nullable: true })
  maxTxVolume?: number; // CHF

  @Column({ type: 'float', nullable: true })
  maxAnnualUserTxVolume?: number; // CHF

  @Column({ length: 'MAX', nullable: true })
  annualUserTxVolumes?: string; // semicolon separated user volumes

  // Acceptance columns

  @Column({ type: 'integer', nullable: true })
  maxUsages?: number;

  @Column({ type: 'integer', default: 0 })
  usages: number;

  @Column({ type: 'integer', nullable: true })
  maxTxUsages?: number;

  @Column({ type: 'integer', default: 0 })
  txUsages: number;

  @Column({ type: 'integer', nullable: true })
  maxUserTxUsages?: number;

  @Column({ length: 'MAX', nullable: true })
  userTxUsages?: string;

  //*** FACTORY METHODS ***//

  increaseUsage(accountType: AccountType, wallet?: Wallet): UpdateResult<Fee> {
    this.verifyForUser(accountType ?? AccountType.PERSONAL, wallet);

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

    const assets = [request.from, request.to].filter((a) => isAsset(a)) as Asset[];
    const fiats = [request.from, request.to].filter((f) => isFiat(f)) as Fiat[];
    const banks = [request.bankIn, request.bankOut];

    return (
      this?.active &&
      !this.isExpired(request.userDataId) &&
      (!this.accountType || this.accountType === request.accountType) &&
      (!this.wallet || this.wallet.id === request.wallet?.id) &&
      (!this.paymentMethodsIn || this.paymentMethodsIn.includes(request.paymentMethodIn)) &&
      (!this.paymentMethodsOut || this.paymentMethodsOut.includes(request.paymentMethodOut)) &&
      (!this.assetList?.length || assets.some((a) => this.assetList.includes(a.id))) &&
      (!this.excludedAssetList?.length || assets.every((a) => !this.excludedAssetList.includes(a.id))) &&
      (!this.fiatList?.length || fiats.some((f) => this.fiatList.includes(f.id))) &&
      (!this.excludedUserDataList?.length ||
        !request.userDataId ||
        !this.excludedUserDataList.includes(request.userDataId)) &&
      (!this.bank || (banks.includes(this.bank.name) && fiats.some((f) => f.name === this.bank.currency))) &&
      (!this.financialTypeList?.length ||
        (fiats.every((f) => this.financialTypeList.includes(f.name)) &&
          assets.every((a) => this.financialTypeList.includes(a.financialType)))) &&
      (!this.maxTxVolume || this.maxTxVolume >= request.txVolume) &&
      (!this.minTxVolume || this.minTxVolume <= request.txVolume) &&
      (!this.maxAnnualUserTxVolume || this.maxAnnualUserTxVolume >= annualUserTxVolume)
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

  get excludedAssetList(): number[] {
    return this.excludedAssets?.split(';')?.map(Number);
  }

  get fiatList(): number[] {
    return this.fiats?.split(';')?.map(Number);
  }

  get excludedUserDataList(): number[] {
    return this.excludedUserDatas?.split(';')?.map(Number);
  }

  get financialTypeList(): string[] {
    return this.financialTypes?.split(';')?.map(String);
  }

  //*** HELPER METHODS ***//+
  private getUserTxUsages(): Record<number, number> {
    return this.parseStringListToRecord(this.userTxUsages);
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
    return this.parseStringListToRecord(this.annualUserTxVolumes);
  }

  private setAnnualUserTxVolumes(volumes: Record<number, number>): void {
    this.annualUserTxVolumes = Object.entries(volumes)
      .map(([userDataId, volume]) => `${userDataId}:${volume}`)
      .join(';');
  }

  private getAnnualUserTxVolume(userDataId: number): number {
    return this.getAnnualUserTxVolumes()[userDataId] ?? 0;
  }

  private parseStringListToRecord(list: string): Record<number, number> {
    return (
      list
        ?.split(';')
        .map((u) => u.split(':'))
        .reduce((prev, [key, value]) => {
          prev[+key] = +value;
          return prev;
        }, {}) ?? {}
    );
  }
}
