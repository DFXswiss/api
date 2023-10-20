import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { FeeDirectionType } from 'src/subdomains/generic/user/models/user/user.entity';
import { IsNull } from 'typeorm';
import { CreateFeeDto } from './dto/create-fee.dto';
import { Fee, FeeType } from './fee.entity';
import { FeeRepository } from './fee.repository';

export interface UserFeeRequest extends FeeRequestBase {
  userData: UserData;
}

export interface FeeRequest extends FeeRequestBase {
  accountType: AccountType;
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
    const existing = await this.feeRepo.findOne({
      where: {
        label: dto.label,
        direction: dto.direction,
      },
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
    this.verifyFee(fee, userData.accountType);

    await this.userDataService.addFee(userData, fee.id.toString());
  }

  async addFeeInternal(userData: UserData, feeId: number): Promise<void> {
    const fee = await this.feeRepo.findOneBy({ id: feeId });
    this.verifyFee(fee, userData.accountType);

    await this.userDataService.addFee(userData, fee.id.toString());
  }

  async getFeeByDiscountCode(discountCode: string): Promise<Fee> {
    const fee = await this.feeRepo.findOneBy({ discountCode });
    if (!fee) throw new NotFoundException(`Discount code ${discountCode} not found`);
    return fee;
  }

  async getUserFee(request: UserFeeRequest): Promise<number> {
    const userFees = await this.getValidUserFees(request);

    return this.calculateFee(userFees, request.userData.id);
  }

  async getDefaultFee(request: FeeRequestBase, accountType = AccountType.PERSONAL): Promise<number> {
    const baseFees = await this.getBaseFees({ ...request, accountType });
    const discounts = await this.getFreeDiscounts({ ...request, accountType });

    return this.calculateFee([...baseFees, ...discounts]);
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

  private async getValidUserFees(request: UserFeeRequest): Promise<Fee[]> {
    const userFees: Fee[] = [];
    const accountType = request.userData.accountType;

    userFees.push(
      ...(await this.getBaseFees({ ...request, accountType })),
      ...(await this.getFreeDiscounts({ ...request, accountType })),
    );

    const discountCodes = request.userData.individualFees?.split(';') ?? [];

    for (const feeId of discountCodes) {
      const fee = await this.feeRepo.findOneBy({ id: +feeId });

      if (this.isExpiredFee(fee, { ...request, accountType })) {
        await this.userDataService.removeFee(request.userData, fee.id.toString());
        continue;
      }

      if (!this.isValidFee(fee, { ...request, accountType })) continue;

      userFees.push(fee);
    }

    return userFees;
  }

  private async getBaseFees(request: FeeRequest): Promise<Fee[]> {
    const baseFees = await this.feeRepo.findBy([
      { type: FeeType.BASE, accountType: request.accountType },
      { type: FeeType.BASE, accountType: IsNull() },
    ]);

    return baseFees.filter((baseFee) => this.isValidFee(baseFee, { ...request, accountType: request.accountType }));
  }

  private async getFreeDiscounts(request: FeeRequest): Promise<Fee[]> {
    const discounts = await this.feeRepo.findBy([
      {
        type: FeeType.DISCOUNT,
        accountType: request.accountType,
        discountCode: IsNull(),
      },
      {
        type: FeeType.DISCOUNT,
        accountType: IsNull(),
        discountCode: IsNull(),
      },
    ]);

    return discounts.filter((discount) => this.isValidFee(discount, { ...request, accountType: request.accountType }));
  }

  private isValidFee(fee: Fee, request: FeeRequest): boolean {
    return !(
      this.isExpiredFee(fee, request) ||
      (fee.direction && fee.direction !== request.direction) ||
      (fee.assets?.length > 0 && request.asset && !fee.assets.split(';').includes(request.asset?.id.toString())) ||
      (fee.maxTxVolume && fee.maxTxVolume < request.txVolume)
    );
  }

  private isExpiredFee(fee: Fee, request: FeeRequest): boolean {
    return (
      !fee ||
      (fee.expiryDate && fee.expiryDate < new Date()) ||
      (fee.accountType && fee.accountType !== request.accountType)
    );
  }

  private async verifyFee(fee: Fee, accountType: AccountType): Promise<void> {
    if (this.isExpiredFee(fee, { accountType: accountType })) throw new BadRequestException('Discount code is expired');

    if (fee.maxUsages && (await this.hasMaxUsageExceeded(fee)))
      throw new BadRequestException('Max usages for discount code taken');
  }

  private async hasMaxUsageExceeded(fee: Fee): Promise<boolean> {
    const usages = await this.userDataService.getFeeUsages(fee.id);
    return usages >= fee.maxUsages;
  }
}
