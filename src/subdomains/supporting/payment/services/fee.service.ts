import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Active, isAsset } from 'src/shared/models/active';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { MoreThan } from 'typeorm';
import { BankService } from '../../bank/bank/bank.service';
import { CardBankName, IbanBankName } from '../../bank/bank/dto/bank.dto';
import { PayoutService } from '../../payout/services/payout.service';
import { PricingService } from '../../pricing/services/pricing.service';
import { InternalChargebackFeeDto, InternalFeeDto } from '../dto/fee.dto';
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
  userData?: UserData;
  wallet?: Wallet;
  accountType?: AccountType;
}

export interface FeeRequestBase {
  wallet?: Wallet;
  paymentMethodIn: PaymentMethod;
  paymentMethodOut?: PaymentMethod;
  bankIn: CardBankName | IbanBankName;
  bankOut?: CardBankName | IbanBankName;
  from: Active;
  to?: Active;
  txVolume?: number;
  specialCodes: string[];
  allowCachedBlockchainFee: boolean;
}

const FeeValidityMinutes = 30;

@Injectable()
export class FeeService implements OnModuleInit {
  private readonly logger = new DfxLogger(FeeService);

  private chf: Fiat;

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
    private readonly bankService: BankService,
  ) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('CHF').then((f) => (this.chf = f));
  }

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.BLOCKCHAIN_FEE_UPDATE, timeout: 1800 })
  async updateBlockchainFees() {
    const blockchainFees = await this.blockchainFeeRepo.find({ relations: ['asset'] });

    for (const blockchainFee of blockchainFees) {
      try {
        blockchainFee.amount = await this.calculateBlockchainFeeInChf(blockchainFee.asset, true);
        blockchainFee.updated = new Date();
        await this.blockchainFeeRepo.save(blockchainFee);
      } catch (e) {
        this.logger.error(`Failed to update blockchain fee of asset id ${blockchainFee.asset.id}:`, e);
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
    if (dto.type === FeeType.BASE && dto.createSpecialCode)
      throw new BadRequestException('Base fees cannot have a specialCode');
    if ((dto.type === FeeType.DISCOUNT || dto.type === FeeType.ADDITION) && !dto.createSpecialCode && dto.maxUsages)
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

    if (dto.excludedAssetIds) {
      const assets = [];

      for (const assetId of dto.excludedAssetIds) {
        const asset = await this.assetService.getAssetById(assetId);
        if (!asset) throw new NotFoundException(`Asset with id ${assetId} not found`);
        assets.push(asset.id);
      }
      fee.excludedAssets = assets.join(';');
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

    if (dto.bank) fee.bank = await this.bankService.getBankById(dto.bank.id);
    if (dto.wallet) fee.wallet = await this.walletService.getByIdOrName(dto.wallet.id);

    if (dto.createSpecialCode) {
      // create hash
      const hash = Util.createHash(fee.label + fee.type).toUpperCase();
      fee.specialCode = `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
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

  async addSpecialCodeUser(user: User, specialCode: string): Promise<void> {
    const cachedFee = await this.getFeeBySpecialCode(specialCode);

    await this.feeRepo.update(...cachedFee.increaseUsage(user.userData.accountType, user.wallet));

    await this.userDataService.addFee(user.userData, cachedFee.id);
  }

  async addFeeInternal(userData: UserData, feeId: number): Promise<void> {
    const cachedFee = await this.getFee(feeId);

    await this.feeRepo.update(...cachedFee.increaseUsage(userData.accountType));

    await this.userDataService.addFee(userData, cachedFee.id);
  }

  async increaseTxUsages(txVolume: number, feeId: number, userData: UserData): Promise<void> {
    const cachedFee = await this.getFee(feeId);

    await this.feeRepo.update(...cachedFee.increaseTxUsage());
    if (cachedFee.maxUserTxUsages) await this.feeRepo.update(...cachedFee.increaseUserTxUsage(userData.id));
    if (cachedFee.maxAnnualUserTxVolume)
      await this.feeRepo.update(...cachedFee.increaseAnnualUserTxVolume(userData.id, txVolume));
  }

  async getFeeBySpecialCode(specialCode: string): Promise<Fee> {
    const fee = await this.getAllFees().then((fees) => fees.find((f) => f.specialCode === specialCode));
    if (!fee) throw new NotFoundException(`Discount code ${specialCode} not found`);
    return fee;
  }

  async getChargebackFee(request: OptionalFeeRequest): Promise<InternalChargebackFeeDto> {
    const userFees = await this.getValidFees(request);

    try {
      return await this.calculateChargebackFee(userFees, request.from, request.allowCachedBlockchainFee);
    } catch (e) {
      this.logger.error(`Fee exception, request: ${JSON.stringify(request)}`);
      throw e;
    }
  }

  async getUserFee(request: UserFeeRequest): Promise<InternalFeeDto> {
    const userFees = await this.getValidFees(request);

    try {
      return await this.calculateFee(
        userFees,
        request.from,
        request.to,
        request.allowCachedBlockchainFee,
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
      return await this.calculateFee(defaultFees, request.from, request.to, request.allowCachedBlockchainFee);
    } catch (e) {
      this.logger.error(`Fee exception, request: ${JSON.stringify(request)}`);
      throw e;
    }
  }

  async getBlockchainFeeInChf(active: Active, allowCached: boolean): Promise<number> {
    if (isAsset(active) && ![AssetType.CUSTOM, AssetType.PRESALE].includes(active.type)) {
      const where = {
        asset: { id: active.id },
        updated: MoreThan(Util.minutesBefore(FeeValidityMinutes)),
      };

      const feeAmount = allowCached
        ? await this.blockchainFeeRepo.findOneCachedBy(`${active.id}`, where).then((fee) => fee?.amount)
        : await this.calculateBlockchainFeeInChf(active, false);
      if (feeAmount == null && !allowCached) throw new Error(`No blockchain fee found for asset ${active.id}`);

      return feeAmount ?? this.getBlockchainMaxFee(active.blockchain);
    } else {
      return 0;
    }
  }

  async getBlockchainFee(active: Active, allowCached: boolean): Promise<number> {
    const price = await this.pricingService.getPrice(active, this.chf, allowCached);

    const blockchainFeeChf = await this.getBlockchainFeeInChf(active, allowCached);
    return price.invert().convert(blockchainFeeChf);
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
    allowCachedBlockchainFee: boolean,
    userDataId?: number,
  ): Promise<InternalFeeDto> {
    const blockchainFee =
      (await this.getBlockchainFeeInChf(from, allowCachedBlockchainFee)) +
      (await this.getBlockchainFeeInChf(to, allowCachedBlockchainFee));

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
        bankRate: 0,
        bankFixed: 0,
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
        bankRate: 0,
        bankFixed: 0,
        payoutRefBonus: customFee.payoutRefBonus,
        network: Math.min(customFee.blockchainFactor * blockchainFee, Config.maxBlockchainFee),
      };

    // get min base fee
    const baseFee = Util.minObj(
      fees.filter((fee) => fee.type === FeeType.BASE),
      'rate',
    );

    // get max discount
    const discountFees = fees.filter((fee) => fee.type === FeeType.DISCOUNT);
    const relativeDiscountFees = fees
      .filter((fee) => fee.type === FeeType.RELATIVE_DISCOUNT)
      .map((fee) => Object.assign(fee, { rate: baseFee.rate * fee.rate }));

    const discountFee = Util.maxObj([...discountFees, ...relativeDiscountFees], 'rate');

    // get addition fees
    const additiveFees = fees.filter((fee) => fee.type === FeeType.ADDITION);

    // get bank fees
    const bankFees = fees.filter((fee) => fee.type === FeeType.BANK);
    const combinedBankFeeRate = Util.sumObjValue(bankFees, 'rate');
    const combinedBankFixedFee = Util.sumObjValue(bankFees, 'fixed');

    const combinedExtraFeeRate = Util.sumObjValue(additiveFees, 'rate') - (discountFee?.rate ?? 0);
    const combinedExtraFixedFee = Util.sumObjValue(additiveFees, 'fixed') - (discountFee?.fixed ?? 0);

    if (!baseFee) throw new InternalServerErrorException('Base fee is missing');
    if (baseFee.rate + combinedExtraFeeRate < 0) {
      this.logger.warn(`Discount is higher than base fee for user data ${userDataId}`);
      return {
        fees: [baseFee],
        rate: baseFee.rate,
        fixed: baseFee.fixed,
        bankRate: combinedBankFeeRate,
        bankFixed: combinedBankFixedFee,
        payoutRefBonus: true,
        network: Math.min(baseFee.blockchainFactor * blockchainFee, Config.maxBlockchainFee),
      };
    }

    return {
      fees: [baseFee, discountFee, ...additiveFees].filter((e) => e != null),
      rate: baseFee.rate + combinedExtraFeeRate,
      fixed: Math.max(baseFee.fixed + combinedExtraFixedFee, 0),
      bankRate: combinedBankFeeRate,
      bankFixed: combinedBankFixedFee,
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

  private async calculateChargebackFee(
    fees: Fee[],
    from: Active,
    allowCachedBlockchainFee: boolean,
  ): Promise<InternalChargebackFeeDto> {
    const blockchainFee = await this.getBlockchainFeeInChf(from, allowCachedBlockchainFee);

    // get chargeback fees
    const chargebackFees = fees.filter((fee) => fee.type === FeeType.CHARGEBACK);
    const chargebackMinFee = Util.minObj(chargebackFees, 'rate');

    const combinedChargebackFeeRate = Util.sumObjValue(chargebackFees, 'rate');
    const combinedChargebackFixedFee = Util.sumObjValue(chargebackFees, 'fixed');

    if (!chargebackFees.length) throw new InternalServerErrorException('Chargeback fee is missing');
    return {
      fees: chargebackFees,
      rate: combinedChargebackFeeRate,
      fixed: combinedChargebackFixedFee ?? 0,
      network: Math.min(chargebackMinFee.blockchainFactor * blockchainFee, Config.maxBlockchainFee),
    };
  }

  private async calculateBlockchainFeeInChf(asset: Asset, allowExpiredPrice: boolean): Promise<number> {
    const { asset: feeAsset, amount } = await this.payoutService.estimateBlockchainFee(asset);
    const price = await this.pricingService.getPrice(feeAsset, this.chf, allowExpiredPrice);

    return price.convert(amount);
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
    const accountType =
      request.user?.userData?.accountType ??
      request.userData?.accountType ??
      request.accountType ??
      AccountType.PERSONAL;
    const wallet = request.wallet ?? request.user?.wallet;
    const userDataId = request.user?.userData?.id ?? request.userData?.id;

    const discountFeeIds = request.user?.userData?.individualFeeList ?? request.userData?.individualFeeList ?? [];

    const userFees = await this.getAllFees().then((fees) =>
      fees.filter(
        (f) =>
          [FeeType.BASE].includes(f.type) ||
          ([
            FeeType.DISCOUNT,
            FeeType.ADDITION,
            FeeType.RELATIVE_DISCOUNT,
            FeeType.CHARGEBACK,
            FeeType.BANK,
            FeeType.SPECIAL,
          ].includes(f.type) &&
            !f.specialCode) ||
          discountFeeIds.includes(f.id) ||
          request.specialCodes.includes(f.specialCode) ||
          (f.wallet && f.wallet.id === wallet?.id),
      ),
    );

    // remove ExpiredFee
    userFees
      .filter((fee) => discountFeeIds.includes(fee.id) && fee.isExpired(userDataId))
      .forEach((fee) => this.userDataService.removeFee(request.user?.userData ?? request.userData, fee.id));

    return userFees.filter((fee) => fee.verifyForTx({ ...request, accountType, wallet, userDataId }));
  }
}
