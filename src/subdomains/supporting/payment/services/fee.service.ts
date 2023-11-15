import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { FeeDirectionType } from 'src/subdomains/generic/user/models/user/user.entity';
import { In, IsNull } from 'typeorm';
import { CreateFeeDto } from '../dto/create-fee.dto';
import { FeeDto } from '../dto/fee.dto';
import { Fee, FeeType } from '../entities/fee.entity';
import { FeeRepository } from '../repositories/fee.repository';

export interface UserFeeRequest extends FeeRequestBase {
  userData: UserData;
}

export interface FeeRequest extends FeeRequestBase {
  accountType: AccountType;
}

export interface OptionalFeeRequest extends FeeRequestBase {
  userData?: UserData;
  accountType?: AccountType;
}

export interface FeeRequestBase {
  direction: FeeDirectionType;
  asset: Asset;
  txVolume?: number;
}

@Injectable()
export class FeeService {
  private readonly logger = new DfxLogger(FeeService);

  constructor(
    private readonly feeRepo: FeeRepository,
    private readonly assetService: AssetService,
    private readonly userDataService: UserDataService,
    private readonly settingService: SettingService,
  ) {}

  async createFee(dto: CreateFeeDto): Promise<Fee> {
    // check if exists
    const existing = await this.feeRepo.findOneBy({
      label: dto.label,
      direction: dto.direction,
    });
    if (existing) throw new BadRequestException('Fee already created');
    if (dto.type === FeeType.BASE && dto.createDiscountCode)
      throw new BadRequestException('Base fees cannot have a discountCode');
    if (dto.type === FeeType.DISCOUNT && !dto.createDiscountCode && dto.maxUsages)
      throw new BadRequestException('Discount fees without a code cannot have a maxUsage');
    if (dto.type === FeeType.BASE && (!dto.accountType || !dto.assetIds))
      throw new BadRequestException('Base fees must have an accountType and assetIds');

    // create the entity
    const fee = this.feeRepo.create(dto);

    if (dto.assetIds) {
      const assets = [];

      for (const assetId of dto.assetIds) {
        const asset = await this.assetService.getAssetById(assetId);
        if (!asset) throw new NotFoundException(`Asset with id ${assetId} not found`);
        assets.push(asset.id);
      }
      fee.assets = assets.join(';');
    }

    if (dto.createDiscountCode) {
      // create hash
      const hash = Util.createHash(fee.label + fee.type).toUpperCase();
      fee.discountCode = `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
    }

    // save
    return this.feeRepo.save(fee);
  }

  async addCustomSignUpFees(
    userData: UserData,
    ref?: string | undefined,
    walletId?: number | undefined,
  ): Promise<void> {
    const customSignUpFees = await this.settingService.getCustomSignUpFees(ref, walletId);
    if (customSignUpFees.length == 0) return;

    for (const feeId of customSignUpFees) {
      try {
        await this.addFeeInternal(userData, feeId);
      } catch (e) {
        this.logger.warn(`Fee mapping error: ${e}; userDataId: ${userData.id}; feeId: ${feeId}`);
        continue;
      }
    }
  }

  async addDiscountCodeUser(userData: UserData, discountCode: string): Promise<void> {
    const fee = await this.getFeeByDiscountCode(discountCode);
    this.verifyFee(fee, userData.accountType);

    await this.feeRepo.update(...fee.increaseUsage());

    await this.userDataService.addFee(userData, fee.id);
  }

  async addFeeInternal(userData: UserData, feeId: number): Promise<void> {
    const fee = await this.feeRepo.findOneBy({ id: feeId });
    this.verifyFee(fee, userData.accountType);

    await this.feeRepo.update(...fee.increaseUsage());

    await this.userDataService.addFee(userData, fee.id);
  }

  async getFeeByDiscountCode(discountCode: string): Promise<Fee> {
    const fee = await this.feeRepo.findOneBy({ discountCode });
    if (!fee) throw new NotFoundException(`Discount code ${discountCode} not found`);
    return fee;
  }

  async getUserFee(request: UserFeeRequest): Promise<FeeDto> {
    const userFees = await this.getValidFees(request);

    return this.calculateFee(userFees, request.userData.id);
  }

  async getDefaultFee(request: FeeRequestBase, accountType = AccountType.PERSONAL): Promise<FeeDto> {
    const defaultFees = await this.getValidFees({ ...request, accountType });

    return this.calculateFee(defaultFees);
  }

  // --- HELPER METHODS --- //

  private async calculateFee(fees: Fee[], userDataId?: number): Promise<FeeDto> {
    // get min custom fee
    const customFee = Util.minObj(
      fees.filter((fee) => fee.type === FeeType.CUSTOM),
      'rate',
    );
    if (customFee) {
      await this.feeRepo.update(...customFee.increaseTxUsage());
      return {
        feeIds: customFee.id.toString(),
        rate: customFee.rate,
        fixed: customFee.fixed ?? 0,
        payoutRefBonus: customFee.payoutRefBonus,
      };
    }

    // get min base fee
    const baseFee = Util.minObj(
      fees.filter((fee) => fee.type === FeeType.BASE),
      'rate',
    );

    // get max discount > 0
    const positiveDiscountFee = Util.maxObj(
      fees.filter((fee) => fee.type === FeeType.DISCOUNT && fee.rate > 0),
      'rate',
    );

    // get min discount < 0
    const negativeDiscountFee = Util.minObj(
      fees.filter((fee) => fee.type === FeeType.DISCOUNT && fee.rate < 0),
      'rate',
    );

    const discountFee: FeeDto = {
      feeIds:
        (positiveDiscountFee ? `;${positiveDiscountFee?.id}` : '') +
        (negativeDiscountFee ? `;${negativeDiscountFee?.id}` : ''),
      rate: (positiveDiscountFee?.rate ?? 0) + (negativeDiscountFee?.rate ?? 0),
      fixed: (positiveDiscountFee?.fixed ?? 0) + (negativeDiscountFee?.fixed ?? 0),
      payoutRefBonus: (positiveDiscountFee?.payoutRefBonus ?? true) && (negativeDiscountFee?.payoutRefBonus ?? true),
    };

    if (!baseFee) throw new InternalServerErrorException('Base fee is missing');
    if (baseFee.rate - discountFee.rate < 0) {
      this.logger.warn(`UserDiscount higher userBaseFee! UserDataId: ${userDataId}`);
      return { feeIds: baseFee.id.toString(), rate: baseFee.rate, fixed: baseFee.fixed, payoutRefBonus: true };
    }

    positiveDiscountFee && (await this.feeRepo.update(...positiveDiscountFee.increaseTxUsage()));
    negativeDiscountFee && (await this.feeRepo.update(...negativeDiscountFee.increaseTxUsage()));

    return {
      feeIds: `${baseFee.id}${discountFee.feeIds}`,
      rate: baseFee.rate - discountFee.rate,
      fixed: Math.max(baseFee.fixed - discountFee.fixed, 0),
      payoutRefBonus: baseFee.payoutRefBonus && discountFee.payoutRefBonus,
    };
  }

  private async getValidFees(request: OptionalFeeRequest): Promise<Fee[]> {
    const accountType = request.userData ? request.userData.accountType : request.accountType;

    const discountFeeIds = request.userData?.individualFeeList ?? [];

    const userFees = await this.feeRepo.findBy([
      { type: FeeType.BASE },
      { type: FeeType.DISCOUNT, discountCode: IsNull() },
      { id: In(discountFeeIds) },
    ]);

    // remove ExpiredFee
    userFees
      .filter((fee) => discountFeeIds.includes(fee.id) && this.isExpiredFee(fee))
      .forEach((fee) => this.userDataService.removeFee(request.userData, fee.id));

    return userFees.filter((fee) => this.isValidFee(fee, { ...request, accountType }));
  }

  private isValidFee(fee: Fee, request: FeeRequest): boolean {
    return !(
      this.isExpiredFee(fee) ||
      (fee.accountType && fee.accountType !== request.accountType) ||
      (fee.direction && fee.direction !== request.direction) ||
      (fee.assetList?.length && !fee.assetList.includes(request.asset?.id)) ||
      (fee.maxTxVolume && fee.maxTxVolume < request.txVolume)
    );
  }

  private isExpiredFee(fee: Fee): boolean {
    return (
      !fee ||
      !fee.active ||
      (fee.expiryDate && fee.expiryDate < new Date()) ||
      (fee.maxTxUsages && fee.txUsages >= fee.maxTxUsages)
    );
  }

  private verifyFee(fee: Fee, accountType: AccountType): void {
    if (this.isExpiredFee(fee)) throw new BadRequestException('Discount code is expired');
    if (fee.accountType && fee.accountType !== accountType) throw new BadRequestException('Account Type not matching');

    if (fee.maxUsages && fee.usages >= fee.maxUsages)
      throw new BadRequestException('Max usages for discount code taken');
  }
}
