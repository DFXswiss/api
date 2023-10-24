import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { FeeDirectionType } from 'src/subdomains/generic/user/models/user/user.entity';
import { In, IsNull } from 'typeorm';
import { CreateFeeDto } from '../dto/create-fee.dto';
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
  direction?: FeeDirectionType;
  asset?: Asset;
  txVolume?: number;
}

@Injectable()
export class FeeService {
  private readonly logger = new DfxLogger(FeeService);

  constructor(
    private readonly feeRepo: FeeRepository,
    private readonly assetService: AssetService,
    private readonly userDataService: UserDataService,
  ) {}

  async createFee(dto: CreateFeeDto): Promise<Fee> {
    // check if exists
    const existing = await this.feeRepo.findOneBy({
      label: dto.label,
      direction: dto.direction,
    });
    if (existing) throw new BadRequestException('Fee already created');
    if (dto.type !== FeeType.DISCOUNT && dto.createDiscountCode)
      throw new BadRequestException('Only discount Fees can have a discountCode');
    if (dto.type === FeeType.BASE && !dto.accountType)
      throw new BadRequestException('Base Fees must have an accountType');

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

  async getAllUserFee(userDataId: number): Promise<{ buy: number; sell: number; crypto: number }> {
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData) throw new NotFoundException('UserData not found');

    return {
      buy: await this.getUserFee({ userData, direction: FeeDirectionType.BUY }),
      sell: await this.getUserFee({ userData, direction: FeeDirectionType.SELL }),
      crypto: await this.getUserFee({ userData, direction: FeeDirectionType.CRYPTO }),
    };
  }

  async getUserFee(request: UserFeeRequest): Promise<number> {
    const userFees = await this.getValidUserFees(request);

    return this.calculateFee(userFees, request.userData.id);
  }

  async getDefaultFee(request: FeeRequestBase, accountType = AccountType.PERSONAL): Promise<number> {
    const defaultFees = await this.getValidUserFees({ ...request, accountType });

    return this.calculateFee(defaultFees);
  }

  // --- HELPER METHODS --- //

  private calculateFee(fees: Fee[], userDataId?: number): number {
    const customFee = Math.min(...fees.filter((f) => f.type === FeeType.CUSTOM).map((f) => f.value));
    if (customFee !== Infinity) return customFee;

    const baseFee = Math.min(...fees.filter((f) => f.type === FeeType.BASE).map((f) => f.value));
    const discountFee = Math.max(...fees.filter((f) => f.type === FeeType.DISCOUNT).map((f) => f.value));
    if (baseFee === Infinity) throw new InternalServerErrorException('Base fee is missing');
    if (baseFee - discountFee < 0) {
      this.logger.warn(`UserDiscount higher userBaseFee! UserDataId: ${userDataId}`);
      return baseFee;
    }

    return baseFee - discountFee;
  }

  private async getValidUserFees(request: OptionalFeeRequest): Promise<Fee[]> {
    const accountType = request.userData ? request.userData.accountType : request.accountType;

    const discountCodes = request.userData?.individualFeeList ?? [];

    const userFees = await this.feeRepo.findBy([
      { type: FeeType.BASE },
      { type: FeeType.DISCOUNT, discountCode: IsNull() },
      { id: In(discountCodes) },
    ]);

    // remove ExpiredFee
    userFees
      .filter((fee) => discountCodes.includes(fee.id) && this.isExpiredFee(fee))
      .forEach((fee) => this.userDataService.removeFee(request.userData, fee.id));

    return userFees.filter((fee) => this.isValidFee(fee, { ...request, accountType }));
  }

  private isValidFee(fee: Fee, request: FeeRequest): boolean {
    return !(
      this.isExpiredFee(fee) ||
      (fee.accountType && fee.accountType !== request.accountType) ||
      (fee.direction && fee.direction !== request.direction) ||
      (fee.assetList && request.asset && !fee.assetList.includes(request.asset?.id)) ||
      (fee.maxTxVolume && fee.maxTxVolume < request.txVolume)
    );
  }

  private isExpiredFee(fee: Fee): boolean {
    return !fee || (fee.expiryDate && fee.expiryDate < new Date());
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
