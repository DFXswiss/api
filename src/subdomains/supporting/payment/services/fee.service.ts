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
    if (dto.type !== FeeType.CUSTOM && dto.additionalFee)
      throw new BadRequestException('Only custom fee can have additionalFee');

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
    await this.verifyFee(fee, userData.accountType);

    await this.userDataService.addFee(userData, fee.id);
  }

  async addFeeInternal(userData: UserData, feeId: number): Promise<void> {
    const fee = await this.feeRepo.findOneBy({ id: feeId });
    await this.verifyFee(fee, userData.accountType);

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

  private calculateFee(fees: Fee[], userDataId?: number): FeeDto {
    // filter customFee with min. value
    const customFee = Util.minObj(
      fees.filter((fee) => fee.type === FeeType.CUSTOM),
      'value',
    );
    if (customFee) return { rate: customFee.value, fixed: customFee.fixedFee ?? 0 };

    // filter baseFee with min. value
    const baseFee = Util.minObj(
      fees.filter((fee) => fee.type === FeeType.BASE),
      'value',
    );

    // filter discount > 0 with max. value
    const positiveDiscountFee = Util.maxObj(
      fees.filter((fee) => fee.type === FeeType.DISCOUNT && fee.value > 0),
      'value',
    );

    // filter discount < 0 with min. value
    const negativeDiscountFee = Util.minObj(
      fees.filter((fee) => fee.type === FeeType.DISCOUNT && fee.value < 0),
      'value',
    );

    const discountFee = {
      rate: (positiveDiscountFee?.value ?? 0) + (negativeDiscountFee?.value ?? 0),
      fixed: (positiveDiscountFee?.fixedFee ?? 0) + (negativeDiscountFee?.fixedFee ?? 0),
    };

    if (!baseFee) throw new InternalServerErrorException('Base fee is missing');
    if (baseFee.value - discountFee.rate < 0) {
      this.logger.warn(`UserDiscount higher userBaseFee! UserDataId: ${userDataId}`);
      return { rate: baseFee.value, fixed: baseFee.fixedFee };
    }

    return {
      rate: baseFee.value - discountFee.rate,
      fixed: discountFee.fixed > baseFee.fixedFee ? 0 : baseFee.fixedFee - discountFee.fixed,
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
    return !fee || !fee.active || (fee.expiryDate && fee.expiryDate < new Date());
  }

  private async verifyFee(fee: Fee, accountType: AccountType): Promise<void> {
    if (this.isExpiredFee(fee)) throw new BadRequestException('Discount code is expired');
    if (fee.accountType && fee.accountType !== accountType) throw new BadRequestException('Account Type not matching');

    if (fee.maxUsages && (await this.hasMaxUsageExceeded(fee)))
      throw new BadRequestException('Max usages for discount code taken');
  }

  private async hasMaxUsageExceeded(fee: Fee): Promise<boolean> {
    const usages = await this.userDataService.getFeeUsages(fee.id);
    return usages >= fee.maxUsages;
  }
}
