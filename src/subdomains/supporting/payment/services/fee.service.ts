import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Active, isAsset } from 'src/shared/models/active';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { MoreThan } from 'typeorm';
import { PayoutService } from '../../payout/services/payout.service';
import { PricingService } from '../../pricing/services/pricing.service';
import { InternalFeeDto } from '../dto/fee.dto';
import { CreateFeeDto } from '../dto/input/create-fee.dto';
import { PaymentMethod } from '../dto/payment-method.enum';
import { Fee, FeeType } from '../entities/fee.entity';
import { BlockchainFeeRepository } from '../repositories/blockchain-fee.repository';
import { FeeRepository } from '../repositories/fee.repository';

export interface UserFeeRequest extends FeeRequestBase {
  user: User;
}

export interface FeeRequest extends FeeRequestBase {
  accountType: AccountType;
  wallet: Wallet;
  userDataId?: number;
}

export interface OptionalFeeRequest extends FeeRequestBase {
  user?: User;
  accountType?: AccountType;
}

export interface FeeRequestBase {
  paymentMethodIn: PaymentMethod;
  paymentMethodOut: PaymentMethod;
  from: Active;
  to: Active;
  txVolume?: number;
  discountCodes: string[];
  allowBlockchainFeeFallback: boolean;
}

const FeeValidityMinutes = 30;

@Injectable()
export class FeeService {
  private readonly logger = new DfxLogger(FeeService);

  constructor(
    private readonly feeRepo: FeeRepository,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly userDataService: UserDataService,
    private readonly settingService: SettingService,
    private readonly walletService: WalletService,
    private readonly blockchainFeeRepo: BlockchainFeeRepository,
    private readonly payoutService: PayoutService,
    private readonly pricingService: PricingService,
  ) {}

  // --- JOBS --- //
  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock(1800)
  async updateBlockchainFees() {
    const blockchainFees = await this.blockchainFeeRepo.find({ relations: ['asset'] });
    const chf = await this.fiatService.getFiatByName('CHF');

    for (const blockchainFee of blockchainFees) {
      try {
        const { asset, amount } = await this.payoutService.estimateBlockchainFee(blockchainFee.asset);
        const price = await this.pricingService.getPrice(asset, chf, true);

        blockchainFee.amount = price.convert(amount);
        blockchainFee.updated = new Date();
        await this.blockchainFeeRepo.save(blockchainFee);
      } catch (e) {
        this.logger.error(`Failed to get fee of asset id ${blockchainFee.asset.id}:`, e);
      }
    }
  }
  async createFee(dto: CreateFeeDto): Promise<Fee> {
    // check if exists
    const existing = await this.feeRepo.findOneBy({
      label: dto.label,
      paymentMethodsIn: dto.paymentMethodsInArray?.join(';'),
      paymentMethodsOut: dto.paymentMethodsOutArray?.join(';'),
    });
    if (existing) throw new BadRequestException('Fee already created');
    if (dto.type === FeeType.BASE && dto.createDiscountCode)
      throw new BadRequestException('Base fees cannot have a discountCode');
    if ((dto.type === FeeType.DISCOUNT || dto.type === FeeType.ADDITION) && !dto.createDiscountCode && dto.maxUsages)
      throw new BadRequestException('Discount fees without a code cannot have a maxUsage');
    if (dto.type === FeeType.BASE && (!dto.accountType || !dto.assetIds))
      throw new BadRequestException('Base fees must have an accountType and assetIds');

    // create the entity
    const fee = this.feeRepo.create(dto);

    if (dto.paymentMethodsInArray) fee.paymentMethodsIn = dto.paymentMethodsInArray.join(';');
    if (dto.paymentMethodsOutArray) fee.paymentMethodsOut = dto.paymentMethodsOutArray.join(';');

    if (dto.assetIds) {
      const assets = [];

      for (const assetId of dto.assetIds) {
        const asset = await this.assetService.getAssetById(assetId);
        if (!asset) throw new NotFoundException(`Asset with id ${assetId} not found`);
        assets.push(asset.id);
      }
      fee.assets = assets.join(';');
    }

    if (dto.fiatIds) {
      const fiats = [];

      for (const fiatId of dto.fiatIds) {
        const fiat = await this.fiatService.getFiat(fiatId);
        if (!fiat) throw new NotFoundException(`Fiat with id ${fiatId} not found`);
        fiats.push(fiat.id);
      }
      fee.fiats = fiats.join(';');
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

  async addCustomSignUpFees(user: User, ref?: string | undefined): Promise<void> {
    const customSignUpFees = await this.settingService.getCustomSignUpFees(ref, user.wallet.id);
    if (customSignUpFees.length == 0) return;

    for (const feeId of customSignUpFees) {
      try {
        const cachedFee = await this.getFee(feeId);

        await this.feeRepo.update(...cachedFee.increaseUsage(user.userData.accountType, user.wallet));

        await this.userDataService.addFee(user.userData, cachedFee.id);
      } catch (e) {
        this.logger.warn(`Fee mapping error: ${e}; userId: ${user.id}; feeId: ${feeId}`);
        continue;
      }
    }
  }

  async addDiscountCodeUser(user: User, discountCode: string): Promise<void> {
    const cachedFee = await this.getFeeByDiscountCode(discountCode);

    await this.feeRepo.update(...cachedFee.increaseUsage(user.userData.accountType, user.wallet));

    await this.userDataService.addFee(user.userData, cachedFee.id);
  }

  async addFeeInternal(userData: UserData, feeId: number): Promise<void> {
    const cachedFee = await this.getFee(feeId);

    await this.feeRepo.update(...cachedFee.increaseUsage(userData.accountType));

    await this.userDataService.addFee(userData, cachedFee.id);
  }

  async increaseTxUsages(txVolume: number, fee: Fee, userData: UserData): Promise<void> {
    const cachedFee = await this.getFee(fee.id);

    await this.feeRepo.update(...cachedFee.increaseTxUsage());
    if (cachedFee.maxUserTxUsages) await this.feeRepo.update(...cachedFee.increaseUserTxUsage(userData.id));
    if (cachedFee.maxAnnualUserTxVolume)
      await this.feeRepo.update(...cachedFee.increaseAnnualUserTxVolume(userData.id, txVolume));
  }

  async getFeeByDiscountCode(discountCode: string): Promise<Fee> {
    const fee = await this.getAllFees().then((fees) => fees.find((f) => f.discountCode === discountCode));
    if (!fee) throw new NotFoundException(`Discount code ${discountCode} not found`);
    return fee;
  }

  async getUserFee(request: UserFeeRequest): Promise<InternalFeeDto> {
    const userFees = await this.getValidFees(request);

    try {
      return await this.calculateFee(
        userFees,
        request.from,
        request.to,
        request.allowBlockchainFeeFallback,
        request.user.userData?.id,
      );
    } catch (e) {
      this.logger.error(`Fee exception, request: ${JSON.stringify(request)}`);
      throw e;
    }
  }

  async getDefaultFee(request: FeeRequestBase, accountType = AccountType.PERSONAL): Promise<InternalFeeDto> {
    const defaultFees = await this.getValidFees({ ...request, accountType });

    try {
      return await this.calculateFee(defaultFees, request.from, request.to, request.allowBlockchainFeeFallback);
    } catch (e) {
      this.logger.error(`Fee exception, request: ${JSON.stringify(request)}`);
      throw e;
    }
  }

  async getBlockchainFee(active: Active, allowFallback: boolean): Promise<number> {
    if (isAsset(active)) {
      const fee = await this.blockchainFeeRepo.findOneCachedBy(`${active.id}`, {
        asset: { id: active.id },
        updated: MoreThan(Util.minutesBefore(FeeValidityMinutes)),
      });
      if (!fee && !allowFallback) throw new Error(`No blockchain fee found for asset ${active.id}`);

      return fee?.amount ?? this.getBlockchainMaxFee(active.blockchain);
    } else {
      return 0;
    }
  }

  // --- HELPER METHODS --- //

  private async getFee(id: number): Promise<Fee> {
    return this.getAllFees().then((fees) => fees.find((f) => f.id === id));
  }

  private async getAllFees(): Promise<Fee[]> {
    return this.feeRepo.findCached('all');
  }

  private async calculateFee(
    fees: Fee[],
    from: Active,
    to: Active,
    allowBlockchainFeeFallback: boolean,
    userDataId?: number,
  ): Promise<InternalFeeDto> {
    const blockchainFee =
      (await this.getBlockchainFee(from, allowBlockchainFeeFallback)) +
      (await this.getBlockchainFee(to, allowBlockchainFeeFallback));

    // get min special fee
    const specialFee = Util.minObj(
      fees.filter((fee) => fee.type === FeeType.SPECIAL),
      'rate',
    );

    if (specialFee)
      return {
        fees: [specialFee],
        rate: specialFee.rate,
        fixed: specialFee.fixed ?? 0,
        payoutRefBonus: specialFee.payoutRefBonus,
        network: Math.min(specialFee.blockchainFactor * blockchainFee, Config.maxBlockchainFee),
      };
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
        network: Math.min(customFee.blockchainFactor * blockchainFee, Config.maxBlockchainFee),
      };

    // get min base fee
    const baseFee = Util.minObj(
      fees.filter((fee) => fee.type === FeeType.BASE),
      'rate',
    );

    // get max discount
    const discountFee = Util.maxObj(
      fees.filter((fee) => fee.type === FeeType.DISCOUNT),
      'rate',
    );

    // get addition fees
    const additiveFees = fees.filter((fee) => fee.type === FeeType.ADDITION);

    const combinedExtraFeeRate = Util.sumObjValue(additiveFees, 'rate') - (discountFee?.rate ?? 0);
    const combinedExtraFixedFee = Util.sumObjValue(additiveFees, 'fixed') - (discountFee?.fixed ?? 0);

    if (!baseFee) throw new InternalServerErrorException('Base fee is missing');
    if (baseFee.rate + combinedExtraFeeRate < 0) {
      this.logger.warn(`Discount is higher than base fee for user data ${userDataId}`);
      return {
        fees: [baseFee],
        rate: baseFee.rate,
        fixed: baseFee.fixed,
        payoutRefBonus: true,
        network: Math.min(baseFee.blockchainFactor * blockchainFee, Config.maxBlockchainFee),
      };
    }

    return {
      fees: [baseFee, discountFee, ...additiveFees].filter((e) => e != null),
      rate: baseFee.rate + combinedExtraFeeRate,
      fixed: Math.max(baseFee.fixed + combinedExtraFixedFee, 0),
      payoutRefBonus:
        baseFee.payoutRefBonus &&
        (discountFee?.payoutRefBonus ?? true) &&
        additiveFees.every((fee) => fee.payoutRefBonus),
      network: Math.min(
        Math.max(
          blockchainFee *
            (baseFee.blockchainFactor -
              (discountFee?.blockchainFactor ?? 0) +
              Util.sumObjValue(additiveFees, 'blockchainFactor')),
          0,
        ),
        Config.maxBlockchainFee,
      ),
    };
  }

  private async getBlockchainMaxFee(blockchain: Blockchain): Promise<number> {
    const maxFee = await this.blockchainFeeRepo.findOneCached(blockchain, {
      where: { asset: { blockchain }, updated: MoreThan(Util.minutesBefore(FeeValidityMinutes)) },
      relations: { asset: true },
      order: { amount: 'DESC' },
    });
    return maxFee?.amount ?? 0;
  }

  private async getValidFees(request: OptionalFeeRequest): Promise<Fee[]> {
    const accountType = request.user?.userData ? request.user.userData?.accountType : request.accountType;
    const wallet = request.user?.wallet;
    const userDataId = request.user?.userData?.id;

    const discountFeeIds = request.user?.userData?.individualFeeList ?? [];

    const userFees = await this.getAllFees().then((fees) =>
      fees.filter(
        (f) =>
          [FeeType.BASE, FeeType.SPECIAL].includes(f.type) ||
          ([FeeType.DISCOUNT, FeeType.ADDITION].includes(f.type) && !f.discountCode) ||
          discountFeeIds.includes(f.id) ||
          request.discountCodes.includes(f.discountCode) ||
          (f.wallet && f.wallet.id === wallet?.id),
      ),
    );

    // remove ExpiredFee
    userFees
      .filter((fee) => discountFeeIds.includes(fee.id) && fee.isExpired(userDataId))
      .forEach((fee) => this.userDataService.removeFee(request.user.userData, fee.id));

    return userFees.filter((fee) => fee.verifyForTx({ ...request, accountType, wallet, userDataId }));
  }
}
