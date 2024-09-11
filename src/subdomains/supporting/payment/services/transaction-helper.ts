import { Inject, Injectable, OnModuleInit, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { Active, isAsset, isFiat } from 'src/shared/models/active';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { KycLevel, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User, UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { AmlRule } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/transaction-helper/min-amount.dto';
import { FeeService, UserFeeRequest } from 'src/subdomains/supporting/payment/services/fee.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { CryptoInput } from '../../payin/entities/crypto-input.entity';
import { PricingService } from '../../pricing/services/pricing.service';
import { FeeDto, InternalFeeDto } from '../dto/fee.dto';
import { FiatPaymentMethod, PaymentMethod } from '../dto/payment-method.enum';
import { QuoteError } from '../dto/transaction-helper/quote-error.enum';
import { TargetEstimation, TransactionDetails } from '../dto/transaction-helper/transaction-details.dto';
import { TxMinSpec, TxSpec } from '../dto/transaction-helper/tx-spec.dto';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from '../repositories/transaction-specification.repository';

@Injectable()
export class TransactionHelper implements OnModuleInit {
  private readonly logger = new DfxLogger(TransactionHelper);
  private readonly addressBalanceCache = new AsyncCache<number>(CacheItemResetPeriod.EVERY_HOUR);

  private chf: Fiat;
  private transactionSpecifications: TransactionSpecification[];

  constructor(
    private readonly specRepo: TransactionSpecificationRepository,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly feeService: FeeService,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly evmRegistryService: EvmRegistryService,
  ) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('CHF').then((f) => (this.chf = f));
    void this.updateCache();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock()
  async updateCache() {
    this.transactionSpecifications = await this.specRepo.find();
  }

  // --- SPECIFICATIONS --- //
  async validateInput(payIn: CryptoInput): Promise<boolean> {
    // check min. volume
    const minVolume = await this.getMinVolumeIn(payIn.asset, payIn.asset, true, payIn.isPayment);
    if (payIn.amount < minVolume * 0.5) return false;

    return true;
  }

  async getMinVolumeIn(
    from: Active,
    fromReference: Active,
    allowExpiredPrice: boolean,
    isPayment: boolean,
  ): Promise<number> {
    const minVolume = isPayment
      ? Config.payment.minVolume
      : this.specRepo.getSpecFor(this.transactionSpecifications, from, TransactionDirection.IN).minVolume;

    const price = await this.pricingService
      .getPrice(fromReference, this.chf, allowExpiredPrice)
      .then((p) => p.invert());
    return this.convert(minVolume, price, isFiat(from));
  }

  async getMinVolumeOut(to: Active, toReference: Active, allowExpiredPrice: boolean): Promise<number> {
    const spec = this.specRepo.getSpecFor(this.transactionSpecifications, to, TransactionDirection.OUT);

    const price = await this.pricingService.getPrice(this.chf, toReference, allowExpiredPrice);
    return this.convert(spec.minVolume, price, isFiat(to));
  }

  async getBlockchainFee(asset: Active, allowCachedBlockchainFee: boolean): Promise<number> {
    return this.feeService.getBlockchainFee(asset, allowCachedBlockchainFee);
  }

  getMinSpecs(from: Active, to: Active): TxMinSpec {
    const { system: fromSystem, asset: fromAsset } = this.specRepo.getProps(from);
    const { system: toSystem, asset: toAsset } = this.specRepo.getProps(to);

    const { minFee, minDeposit } = this.getDefaultSpecs(fromSystem, fromAsset, toSystem, toAsset);

    return { minFee: minFee.amount, minVolume: minDeposit.amount };
  }

  getDefaultSpecs(
    fromSystem: string,
    fromAsset: string,
    toSystem: string,
    toAsset: string,
  ): { minFee: MinAmount; minDeposit: MinAmount } {
    const inSpec = this.specRepo.getSpec(
      this.transactionSpecifications,
      fromSystem,
      fromAsset,
      TransactionDirection.IN,
    );
    const outSpec = this.specRepo.getSpec(this.transactionSpecifications, toSystem, toAsset, TransactionDirection.OUT);

    return {
      minFee: { amount: outSpec.minFee + inSpec.minFee, asset: 'CHF' },
      minDeposit: {
        amount: Math.max(outSpec.minVolume, inSpec.minVolume),
        asset: 'CHF',
      },
    };
  }

  // --- TARGET ESTIMATION --- //
  async getTxFeeInfos(
    inputReferenceAmount: number,
    inputAmountChf: number,
    from: Active,
    fromReference: Active,
    to: Active,
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    user: User,
  ): Promise<InternalFeeDto & FeeDto> {
    // get fee
    const [fee, networkStartFee] = await Promise.all([
      this.getTxFee(user, paymentMethodIn, paymentMethodOut, from, to, inputAmountChf, [], false),
      this.getNetworkStartFee(to, false, user),
    ]);

    // get specs
    const minSpecs = this.getMinSpecs(from, to);
    const specs: TxSpec = {
      fee: { min: minSpecs.minFee, fixed: fee.fixed, network: fee.network, networkStart: networkStartFee },
      volume: { min: minSpecs.minVolume, max: Number.MAX_VALUE },
    };

    const sourceSpecs = await this.getSourceSpecs(fromReference, specs, false);

    const { dfx, total } = this.calculateTotalFee(inputReferenceAmount, fee.rate, sourceSpecs, isFiat(from));

    return {
      ...fee,
      ...sourceSpecs.fee,
      total,
      dfx,
    };
  }

  async getTxDetails(
    sourceAmount: number | undefined,
    targetAmount: number | undefined,
    from: Active,
    to: Active,
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    allowExpiredPrice: boolean,
    user?: User,
    discountCodes: string[] = [],
  ): Promise<TransactionDetails> {
    const txAsset = targetAmount ? to : from;
    const txAmount = targetAmount ?? sourceAmount;

    const chfPrice = await this.pricingService.getPrice(txAsset, this.chf, true);
    const txAmountChf = chfPrice.convert(txAmount);

    // get fee
    const [fee, networkStartFee] = await Promise.all([
      this.getTxFee(user, paymentMethodIn, paymentMethodOut, from, to, txAmountChf, discountCodes, true),
      this.getNetworkStartFee(to, allowExpiredPrice, user),
    ]);

    // get specs (CHF)
    const specs = this.getMinSpecs(from, to);

    const { kycLimit, defaultLimit } = await this.getLimits(paymentMethodIn, paymentMethodOut, user);

    const error = this.getTxError(
      from,
      to,
      paymentMethodIn,
      txAmountChf,
      specs.minVolume,
      defaultLimit,
      kycLimit,
      user,
    );

    // target estimation
    const extendedSpecs: TxSpec = {
      fee: { network: fee.network, fixed: fee.fixed, min: specs.minFee, networkStart: networkStartFee },
      volume: {
        min: specs.minVolume,
        max: error === QuoteError.LIMIT_EXCEEDED ? kycLimit : Math.min(kycLimit, defaultLimit),
      },
    };

    const sourceSpecs = await this.getSourceSpecs(from, extendedSpecs, allowExpiredPrice);
    const targetSpecs = await this.getTargetSpecs(to, extendedSpecs, allowExpiredPrice);

    const target = await this.getTargetEstimation(
      sourceAmount,
      targetAmount,
      fee.rate,
      sourceSpecs,
      targetSpecs,
      from,
      to,
      allowExpiredPrice,
    );

    return {
      ...target,
      minVolume: sourceSpecs.volume.min,
      minVolumeTarget: targetSpecs.volume.min,
      maxVolume: sourceSpecs.volume.max ?? undefined,
      maxVolumeTarget: targetSpecs.volume.max ?? undefined,
      isValid: error == null,
      error,
    };
  }

  async getVolumeChfSince(
    inputAmount: number,
    from: Active,
    allowExpiredPrice: boolean,
    dateFrom: Date,
    dateTo: Date,
    users?: User[],
    type?: 'cryptoInput' | 'checkoutTx' | 'bankTx',
  ): Promise<number> {
    const price = await this.pricingService.getPrice(from, this.chf, allowExpiredPrice);

    if (!users?.length) return price.convert(inputAmount);

    const previousVolume = await this.getVolumeSince(dateFrom, dateTo, users, type);

    return price.convert(inputAmount) + previousVolume;
  }

  async getVolumeSince(
    dateFrom: Date,
    dateTo: Date,
    users: User[],
    type?: 'cryptoInput' | 'checkoutTx' | 'bankTx',
  ): Promise<number> {
    const buyCryptoVolume = await this.buyCryptoService.getUserVolume(
      users.map((u) => u.id),
      dateFrom,
      dateTo,
      type,
    );
    const buyFiatVolume = await this.buyFiatService.getUserVolume(
      users.map((u) => u.id),
      dateFrom,
      dateTo,
    );

    return buyCryptoVolume + buyFiatVolume;
  }

  private async getNetworkStartFee(to: Active, allowExpiredPrice: boolean, user?: User): Promise<number> {
    if (
      allowExpiredPrice ||
      DisabledProcess(Process.NETWORK_START_FEE) ||
      !isAsset(to) ||
      to.type === AssetType.COIN ||
      !Config.networkStartBlockchains.includes(to.blockchain) ||
      !user
    )
      return 0;

    try {
      const evmClient = this.evmRegistryService.getClient(to.blockchain);
      const userBalance = await this.addressBalanceCache.get(`${user.address}-${to.blockchain}`, () =>
        evmClient.getNativeCoinBalanceForAddress(user.address),
      );

      return userBalance < Config.networkStartBalanceLimit ? Config.networkStartFee : 0;
    } catch (e) {
      this.logger.error(`Failed to get network start fee for user ${user.id} on ${to.blockchain}:`, e);
      return 0;
    }
  }

  private async getTxFee(
    user: User | undefined,
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    from: Active,
    to: Active,
    txVolumeChf: number,
    discountCodes: string[],
    allowCachedBlockchainFee: boolean,
  ): Promise<InternalFeeDto> {
    const feeRequest: UserFeeRequest = {
      user,
      paymentMethodIn,
      paymentMethodOut,
      from,
      to,
      txVolume: txVolumeChf,
      discountCodes,
      allowCachedBlockchainFee,
    };

    return user ? this.feeService.getUserFee(feeRequest) : this.feeService.getDefaultFee(feeRequest);
  }

  private async getTargetEstimation(
    inputAmount: number | undefined,
    outputAmount: number | undefined,
    feeRate: number,
    sourceSpecs: TxSpec,
    targetSpecs: TxSpec,
    from: Active,
    to: Active,
    allowExpiredPrice: boolean,
  ): Promise<TargetEstimation> {
    const price = await this.pricingService.getPrice(from, to, allowExpiredPrice);
    const outputAmountSource = outputAmount && price.invert().convert(outputAmount);

    const sourceAmount = inputAmount ?? this.getInputAmount(outputAmountSource, feeRate, sourceSpecs);
    const sourceFees = this.calculateTotalFee(sourceAmount, feeRate, sourceSpecs, isFiat(from));

    const targetAmount = outputAmount ?? price.convert(Math.max(inputAmount - sourceFees.total, 0));
    const targetFees = {
      dfx: this.convert(sourceFees.dfx, price, isFiat(to)),
      total: this.convert(sourceFees.total, price, isFiat(to)),
    };

    return {
      timestamp: price.timestamp,
      exchangeRate: Util.roundReadable(price.price, isFiat(from)),
      rate: targetAmount ? Util.roundReadable(sourceAmount / targetAmount, isFiat(from)) : Number.MAX_VALUE,
      sourceAmount: Util.roundReadable(sourceAmount, isFiat(from)),
      estimatedAmount: Util.roundReadable(targetAmount, isFiat(to)),
      exactPrice: price.isValid,
      priceSteps: price.steps,
      feeSource: {
        rate: feeRate,
        ...sourceSpecs.fee,
        ...sourceFees,
      },
      feeTarget: {
        rate: feeRate,
        ...targetSpecs.fee,
        ...targetFees,
      },
    };
  }

  private getInputAmount(outputAmount: number, rate: number, { fee: { min, fixed, network } }: TxSpec): number {
    const inputAmountNormal = (outputAmount + fixed + network) / (1 - rate);
    const inputAmountWithMinFee = outputAmount + network + min;

    return Math.max(inputAmountNormal, inputAmountWithMinFee);
  }

  // --- HELPER METHODS --- //

  private async getSourceSpecs(from: Active, { fee, volume }: TxSpec, allowExpiredPrice: boolean): Promise<TxSpec> {
    const price = await this.pricingService.getPrice(from, this.chf, allowExpiredPrice).then((p) => p.invert());

    return {
      fee: {
        min: this.convert(fee.min, price, isFiat(from)),
        fixed: this.convert(fee.fixed, price, isFiat(from)),
        network: this.convert(fee.network, price, isFiat(from)),
        networkStart: fee.networkStart != null ? this.convert(fee.networkStart, price, isFiat(from)) : undefined,
      },
      volume: {
        min: this.convert(volume.min, price, isFiat(from)),
        max: this.roundMaxAmount(from.name === 'CHF' ? volume.max : price.convert(volume.max * 0.99), isFiat(from)), // -1% for the conversion
      },
    };
  }

  private async getTargetSpecs(to: Active, { fee, volume }: TxSpec, allowExpiredPrice: boolean): Promise<TxSpec> {
    const price = await this.pricingService.getPrice(this.chf, to, allowExpiredPrice);

    return {
      fee: {
        min: this.convert(fee.min, price, isFiat(to)),
        fixed: this.convert(fee.fixed, price, isFiat(to)),
        network: this.convert(fee.network, price, isFiat(to)),
        networkStart: fee.networkStart != null ? this.convert(fee.networkStart, price, isFiat(to)) : undefined,
      },
      volume: {
        min: this.convert(volume.min, price, isFiat(to)),
        max: this.roundMaxAmount(to.name === 'CHF' ? volume.max : price.convert(volume.max * 0.99), isFiat(to)), // -1% for the conversion
      },
    };
  }

  private calculateTotalFee(
    amount: number,
    rate: number,
    { fee: { fixed, min, network, networkStart } }: TxSpec,
    isFiat: boolean,
  ): { dfx: number; total: number } {
    const dfx = Math.max(amount * rate + fixed, min);
    const total = dfx + network + (networkStart ?? 0);

    return { dfx: Util.roundReadable(dfx, isFiat), total: Util.roundReadable(total, isFiat) };
  }

  private convert(amount: number, price: Price, isFiat: boolean): number {
    const targetAmount = price.convert(amount);
    return Util.roundReadable(targetAmount, isFiat);
  }

  private roundMaxAmount(amount: number, isFiat: boolean): number {
    return isFiat ? Util.round(amount, -1) : Util.roundByPrecision(amount, 3);
  }

  private async getLimits(
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    user?: User,
  ): Promise<{ kycLimit: number; defaultLimit: number }> {
    const volume24h =
      user?.userData.kycLevel < KycLevel.LEVEL_50
        ? await this.getVolumeSince(Util.daysBefore(1), new Date(), [user])
        : 0;

    const kycLimit = (user?.userData.availableTradingLimit ?? Number.MAX_VALUE) - volume24h;

    const defaultLimit = [paymentMethodIn, paymentMethodOut].includes(FiatPaymentMethod.CARD)
      ? Config.tradingLimits.cardDefault
      : Config.tradingLimits.yearlyDefault;

    return { kycLimit, defaultLimit };
  }

  private getTxError(
    from: Active,
    to: Active,
    paymentMethodIn: PaymentMethod,
    txAmountChf: number,
    minAmountChf: number,
    maxAmountChf: number,
    kycLimitChf: number,
    user?: User,
  ): QuoteError | undefined {
    const isBuy = isFiat(from) && isAsset(to);
    const isSell = isAsset(from) && isFiat(to);
    const isSwap = isAsset(from) && isAsset(to);

    // KYC checks
    if (isBuy) {
      if (
        user?.status === UserStatus.NA &&
        ((user?.wallet.amlRule === AmlRule.RULE_2 && user?.userData.kycLevel < KycLevel.LEVEL_30) ||
          (user?.wallet.amlRule === AmlRule.RULE_3 && user?.userData.kycLevel < KycLevel.LEVEL_50) ||
          (user?.wallet.amlRule === AmlRule.RULE_6 &&
            paymentMethodIn === FiatPaymentMethod.CARD &&
            user?.userData.kycLevel < KycLevel.LEVEL_30) ||
          (user?.wallet.amlRule === AmlRule.RULE_7 &&
            paymentMethodIn === FiatPaymentMethod.CARD &&
            user?.userData.kycLevel < KycLevel.LEVEL_50))
      )
        return QuoteError.KYC_REQUIRED;
    }

    if (isSwap && user?.userData.kycLevel < KycLevel.LEVEL_30 && user?.userData.status !== UserDataStatus.ACTIVE)
      return QuoteError.KYC_REQUIRED;

    if (paymentMethodIn === FiatPaymentMethod.INSTANT && user && !user.userData.olkypayAllowed)
      return QuoteError.KYC_REQUIRED_INSTANT;

    if (isSell && user && !user.userData.isDataComplete) return QuoteError.KYC_DATA_REQUIRED;

    // limit checks
    if (user && txAmountChf > kycLimitChf) return QuoteError.LIMIT_EXCEEDED;

    // verification checks
    if (
      ((isSell && to.name !== 'CHF') || paymentMethodIn === FiatPaymentMethod.CARD || isSwap) &&
      user &&
      !user.userData.hasBankTxVerification &&
      txAmountChf > Config.tradingLimits.dailyDefault
    )
      return QuoteError.BANK_TRANSACTION_MISSING;

    // amount checks
    if (txAmountChf < minAmountChf) return QuoteError.AMOUNT_TOO_LOW;
    if (txAmountChf > maxAmountChf) return QuoteError.AMOUNT_TOO_HIGH;
  }
}
