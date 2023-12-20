import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { FeeDirectionType, User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { In, IsNull } from 'typeorm';
import { CreateFeeDto } from '../dto/create-fee.dto';
import { FeeDto } from '../dto/fee.dto';
import { Fee, FeeType } from '../entities/fee.entity';
import { FeeRepository } from '../repositories/fee.repository';

export interface UserFeeRequest extends FeeRequestBase {
  user: User;
}

export interface FeeRequest extends FeeRequestBase {
  accountType: AccountType;
  wallet?: Wallet;
}

export interface OptionalFeeRequest extends FeeRequestBase {
  user?: User;
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
    private readonly walletService: WalletService,
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

    if (dto.wallet) fee.wallet = await this.walletService.getByIdOrName(dto.wallet.id);

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

    await this.feeRepo.update(...fee.increaseUsage(userData.accountType));

    await this.userDataService.addFee(userData, fee.id);
  }

  async addFeeInternal(userData: UserData, feeId: number): Promise<void> {
    const fee = await this.feeRepo.findOneBy({ id: feeId });

    await this.feeRepo.update(...fee.increaseUsage(userData.accountType));

    await this.userDataService.addFee(userData, fee.id);
  }

  async increaseTxUsage(fee: Fee): Promise<void> {
    await this.feeRepo.update(...fee.increaseTxUsage());
  }

  async getFeeByDiscountCode(discountCode: string): Promise<Fee> {
    const fee = await this.feeRepo.findOneBy({ discountCode });
    if (!fee) throw new NotFoundException(`Discount code ${discountCode} not found`);
    return fee;
  }

  async getUserFee(request: UserFeeRequest): Promise<FeeDto> {
    const userFees = await this.getValidFees(request);

    return this.calculateFee(userFees, request.user.userData?.id);
  }

  async getDefaultFee(request: FeeRequestBase, accountType = AccountType.PERSONAL): Promise<FeeDto> {
    const defaultFees = await this.getValidFees({ ...request, accountType });

    return this.calculateFee(defaultFees);
  }

  // --- HELPER METHODS --- //

  private calculateFee(fees: Fee[], userDataId?: number): FeeDto {
    // get min custom fee
    const customFee = Util.minObj(
      fees.filter((fee) => fee.type === FeeType.CUSTOM),
      'rate',
    );
    if (customFee)
      return {
        fees: [customFee],
        rate: customFee.rate,
        fixed: customFee.fixed ?? 0,
        payoutRefBonus: customFee.payoutRefBonus,
      };

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
      fees: [positiveDiscountFee, negativeDiscountFee],
      rate: (positiveDiscountFee?.rate ?? 0) + (negativeDiscountFee?.rate ?? 0),
      fixed: (positiveDiscountFee?.fixed ?? 0) + (negativeDiscountFee?.fixed ?? 0),
      payoutRefBonus: (positiveDiscountFee?.payoutRefBonus ?? true) && (negativeDiscountFee?.payoutRefBonus ?? true),
    };

    if (!baseFee) throw new InternalServerErrorException('Base fee is missing');
    if (baseFee.rate - discountFee.rate < 0) {
      this.logger.warn(`UserDiscount higher userBaseFee! UserDataId: ${userDataId}`);
      return { fees: [baseFee], rate: baseFee.rate, fixed: baseFee.fixed, payoutRefBonus: true };
    }

    return {
      fees: [baseFee, ...discountFee.fees].filter((e) => e != null),
      rate: baseFee.rate - discountFee.rate,
      fixed: Math.max(baseFee.fixed - discountFee.fixed, 0),
      payoutRefBonus: baseFee.payoutRefBonus && discountFee.payoutRefBonus,
    };
  }

  private async getValidFees(request: OptionalFeeRequest): Promise<Fee[]> {
    const accountType = request.user?.userData ? request.user.userData?.accountType : request.accountType;
    const wallet = request.user?.wallet;

    const discountFeeIds = request.user?.userData?.individualFeeList ?? [];

    const userFees = await this.feeRepo.findBy([
      { type: FeeType.BASE },
      { type: FeeType.DISCOUNT, discountCode: IsNull() },
      { id: In(discountFeeIds) },
    ]);

    // remove ExpiredFee
    userFees
      .filter((fee) => discountFeeIds.includes(fee.id) && fee.isExpired())
      .forEach((fee) => this.userDataService.removeFee(request.user.userData, fee.id));

    return userFees.filter((fee) => fee.verifyForTx({ ...request, accountType, wallet }));
  }
}
