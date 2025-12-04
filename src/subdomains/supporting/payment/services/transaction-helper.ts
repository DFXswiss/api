import { BadRequestException, ForbiddenException, Inject, Injectable, OnModuleInit, forwardRef } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config, Environment } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { TronService } from 'src/integration/blockchain/tron/services/tron.service';
import { Active, amountType, feeAmountType, isAsset, isFiat } from 'src/shared/models/active';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { DfxCron } from 'src/shared/utils/cron';
import { AmountType, Util } from 'src/shared/utils/util';
import { AmlRule } from 'src/subdomains/core/aml/enums/aml-rule.enum';
import { AmlHelperService } from 'src/subdomains/core/aml/services/aml-helper.service';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { RefundDataDto } from 'src/subdomains/core/history/dto/refund-data.dto';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycIdentificationType } from 'src/subdomains/generic/user/models/user-data/kyc-identification-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/transaction-helper/min-amount.dto';
import { FeeService, UserFeeRequest } from 'src/subdomains/supporting/payment/services/fee.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { BankTxReturn } from '../../bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTx } from '../../bank-tx/bank-tx/entities/bank-tx.entity';
import { CardBankName, IbanBankName } from '../../bank/bank/dto/bank.dto';
import { CryptoInput, PayInConfirmationType } from '../../payin/entities/crypto-input.entity';
import { PriceCurrency, PriceValidity, PricingService } from '../../pricing/services/pricing.service';
import { FeeDto, InternalFeeDto } from '../dto/fee.dto';
import { FiatPaymentMethod, PaymentMethod } from '../dto/payment-method.enum';
import { QuoteError } from '../dto/transaction-helper/quote-error.enum';
import { TargetEstimation, TransactionDetails } from '../dto/transaction-helper/transaction-details.dto';
import { TxMinSpec, TxSpec } from '../dto/transaction-helper/tx-spec.dto';
import { TxStatementDetails, TxStatementType } from '../dto/transaction-helper/tx-statement-details.dto';
import { TransactionType } from '../dto/transaction.dto';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from '../repositories/transaction-specification.repository';
import { TransactionService } from './transaction.service';

@Injectable()
export class TransactionHelper implements OnModuleInit {
  private readonly logger = new DfxLogger(TransactionHelper);

  private readonly addressBalanceCache = new AsyncCache<number>(CacheItemResetPeriod.EVERY_HOUR);
  private readonly user30dVolumeCache = new AsyncCache<number>(CacheItemResetPeriod.EVERY_HOUR);

  private transactionSpecifications: TransactionSpecification[];

  constructor(
    private readonly specRepo: TransactionSpecificationRepository,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly feeService: FeeService,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    @Inject(forwardRef(() => BuyFiatService))
    private readonly buyFiatService: BuyFiatService,
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly walletService: WalletService,
    private readonly transactionService: TransactionService,
    private readonly buyService: BuyService,
    private readonly assetService: AssetService,
  ) {}

  onModuleInit() {
    void this.updateCache();
  }

  @DfxCron(CronExpression.EVERY_5_MINUTES)
  async updateCache() {
    this.transactionSpecifications = await this.specRepo.find();
  }

  // --- SPECIFICATIONS --- //
  async validateInput(payIn: CryptoInput): Promise<boolean> {
    // check min. volume
    const minVolume = await this.getMinVolumeIn(payIn.asset, payIn.asset, PriceValidity.ANY, payIn.isPayment);
    if (payIn.amount < minVolume * 0.5) return false;

    return true;
  }

  async getMinVolumeIn(
    from: Active,
    fromReference: Active,
    priceValidity: PriceValidity,
    isPayment: boolean,
  ): Promise<number> {
    const minVolume = isPayment
      ? Config.payment.minVolume
      : this.specRepo.getSpecFor(this.transactionSpecifications, from, TransactionDirection.IN).minVolume;

    const price = await this.pricingService
      .getPrice(fromReference, PriceCurrency.CHF, priceValidity)
      .then((p) => p.invert());
    return this.convert(minVolume, price, from);
  }

  async getMinVolumeOut(
    to: Active,
    toReference: Active,
    priceValidity: PriceValidity,
    isPayment: boolean,
  ): Promise<number> {
    const minVolume = isPayment
      ? Config.payment.minVolume
      : this.specRepo.getSpecFor(this.transactionSpecifications, to, TransactionDirection.OUT).minVolume;

    const price = await this.pricingService.getPrice(PriceCurrency.CHF, toReference, priceValidity);
    return this.convert(minVolume, price, to);
  }

  async getMinVolume(
    from: Active,
    to: Active,
    fromReference: Active,
    priceValidity: PriceValidity,
    isPayment: boolean,
  ): Promise<number> {
    const minVolume = isPayment ? Config.payment.minVolume : this.getMinSpecs(from, to).minVolume;

    const price = await this.pricingService
      .getPrice(fromReference, PriceCurrency.CHF, priceValidity)
      .then((p) => p.invert());
    return this.convert(minVolume, price, from);
  }

  async getBlockchainFee(asset: Active, allowCached: boolean): Promise<number> {
    return this.feeService.getBlockchainFee(asset, allowCached);
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

  async getMinConfirmations(payIn: CryptoInput, direction: PayInConfirmationType): Promise<number> {
    const spec = this.specRepo.getSpec(
      this.transactionSpecifications,
      payIn.asset.blockchain,
      payIn.asset.name,
      direction == PayInConfirmationType.INPUT ? TransactionDirection.IN : TransactionDirection.OUT,
    );
    return spec?.minConfirmations ?? 0;
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
    bankIn: CardBankName | IbanBankName | undefined,
    bankOut: CardBankName | IbanBankName | undefined,
    user: User,
  ): Promise<InternalFeeDto & FeeDto> {
    // get fee
    const [fee, networkStartFee] = await this.getAllFees(
      user,
      undefined,
      paymentMethodIn,
      paymentMethodOut,
      bankIn,
      bankOut,
      from,
      to,
      inputAmountChf,
      [],
      true,
      false,
    );

    // get specs
    const minSpecs = this.getMinSpecs(from, to);
    const specs: TxSpec = {
      fee: {
        min: minSpecs.minFee,
        fixed: fee.fixed,
        network: fee.network,
        networkStart: networkStartFee,
        bankFixed: fee.bankFixed,
      },
      volume: { min: minSpecs.minVolume, max: Number.MAX_VALUE },
    };

    const sourceSpecs = await this.getSourceSpecs(fromReference, specs, PriceValidity.VALID_ONLY);

    const { dfx, bank, total } = this.calculateTotalFee(
      inputReferenceAmount,
      fee.rate,
      fee.bankRate,
      sourceSpecs,
      from,
    );

    return {
      ...fee,
      ...sourceSpecs.fee,
      total,
      dfx,
      bank,
    };
  }

  async getTxDetails(
    sourceAmount: number | undefined,
    targetAmount: number | undefined,
    from: Active,
    to: Active,
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    exactPrice: boolean,
    user?: User,
    walletName?: string,
    specialCodes: string[] = [],
    ibanCountry?: string,
  ): Promise<TransactionDetails> {
    const priceValidity = exactPrice ? PriceValidity.PREFER_VALID : PriceValidity.ANY;

    const txAsset = targetAmount ? to : from;
    const txAmount = targetAmount ?? sourceAmount;

    const chfPrice = await this.pricingService.getPrice(txAsset, PriceCurrency.CHF, PriceValidity.ANY);
    const txAmountChf = chfPrice.convert(txAmount);

    const bankIn = this.getDefaultBankByPaymentMethod(paymentMethodIn);
    const bankOut = this.getDefaultBankByPaymentMethod(paymentMethodOut);

    const wallet = walletName ? await this.walletService.getByIdOrName(undefined, walletName) : undefined;

    // get fee
    const [fee, networkStartFee] = await this.getAllFees(
      user,
      wallet,
      paymentMethodIn,
      paymentMethodOut,
      bankIn,
      bankOut,
      from,
      to,
      txAmountChf,
      specialCodes,
      exactPrice,
      true,
    );

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
      ibanCountry,
    );

    // target estimation
    const extendedSpecs: TxSpec = {
      fee: {
        network: fee.network,
        fixed: fee.fixed,
        min: specs.minFee,
        networkStart: networkStartFee,
        bankFixed: fee.bankFixed,
      },
      volume: {
        min: specs.minVolume,
        max: error === QuoteError.LIMIT_EXCEEDED ? kycLimit : Math.min(kycLimit, defaultLimit),
      },
    };

    const sourceSpecs = await this.getSourceSpecs(from, extendedSpecs, priceValidity);
    const targetSpecs = await this.getTargetSpecs(to, extendedSpecs, priceValidity);

    const target = await this.getTargetEstimation(
      sourceAmount,
      targetAmount,
      fee.rate,
      fee.bankRate,
      sourceSpecs,
      targetSpecs,
      from,
      to,
      priceValidity,
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
    tx: BuyCrypto | BuyFiat,
    users: User[],
    dateFrom: Date,
    dateTo: Date,
    priceValidity: PriceValidity,
    type?: 'cryptoInput' | 'checkoutTx' | 'bankTx',
    price?: Price,
    from?: Active,
  ): Promise<number> {
    const previousVolume = await this.getVolumeSince(dateFrom, dateTo, users, tx, type);

    price ??= await this.pricingService.getPrice(from, PriceCurrency.CHF, priceValidity);

    return price.convert(tx.inputReferenceAmount) + previousVolume;
  }

  async getVolumeSince(
    dateFrom: Date,
    dateTo: Date,
    users: User[],
    excluded?: BuyCrypto | BuyFiat,
    type?: 'cryptoInput' | 'checkoutTx' | 'bankTx',
  ): Promise<number> {
    const buyCryptoVolume = await this.buyCryptoService.getUserVolume(
      users.map((u) => u.id),
      dateFrom,
      dateTo,
      excluded instanceof BuyCrypto ? excluded.id : undefined,
      type,
    );
    const buyFiatVolume =
      !type || type === 'cryptoInput'
        ? await this.buyFiatService.getUserVolume(
            users.map((u) => u.id),
            dateFrom,
            dateTo,
            excluded instanceof BuyFiat ? excluded.id : undefined,
          )
        : 0;

    return buyCryptoVolume + buyFiatVolume;
  }

  async getRefundData(
    refundEntity: BankTx | BuyCrypto | BuyFiat | BankTxReturn,
    userData: UserData,
    bankIn: CardBankName | IbanBankName,
    refundTarget: string,
    isFiat: boolean,
  ): Promise<RefundDataDto> {
    const inputCurrency = await this.getRefundActive(refundEntity);
    if (!inputCurrency.refundEnabled) throw new BadRequestException(`Refund for ${inputCurrency.name} not allowed`);

    const price = await this.pricingService.getPrice(PriceCurrency.CHF, inputCurrency, PriceValidity.VALID_ONLY);

    const amountType = !isFiat ? AmountType.ASSET : AmountType.FIAT;
    const feeAmountType = !isFiat ? AmountType.ASSET_FEE : AmountType.FIAT_FEE;

    const inputAmount = Util.roundReadable(refundEntity.refundAmount, amountType);

    const chargebackFee = await this.feeService.getChargebackFee({
      from: inputCurrency,
      txVolume: price.invert().convert(inputAmount),
      paymentMethodIn: refundEntity.paymentMethodIn,
      bankIn,
      specialCodes: [],
      allowCachedBlockchainFee: false,
      userData,
    });

    const dfxFeeAmount = inputAmount * chargebackFee.rate + price.convert(chargebackFee.fixed);
    const networkFeeAmount = price.convert(chargebackFee.network);
    const bankFeeAmount =
      refundEntity.paymentMethodIn === FiatPaymentMethod.BANK
        ? price.convert(
            chargebackFee.bankRate * inputAmount + chargebackFee.bankFixed + refundEntity.chargebackBankFee * 1.01,
          )
        : 0; // Bank fee buffer 1%

    const totalFeeAmount = Util.roundReadable(dfxFeeAmount + networkFeeAmount + bankFeeAmount, feeAmountType);
    if (totalFeeAmount >= inputAmount) throw new BadRequestException('Transaction fee is too expensive');

    const refundAsset =
      inputCurrency instanceof Asset ? AssetDtoMapper.toDto(inputCurrency) : FiatDtoMapper.toDto(inputCurrency);

    return {
      expiryDate: Util.secondsAfter(Config.transactionRefundExpirySeconds),
      inputAmount: Util.roundReadable(inputAmount, amountType),
      inputAsset: refundAsset,
      refundAmount: Util.roundReadable(inputAmount - totalFeeAmount, amountType),
      fee: {
        dfx: Util.roundReadable(dfxFeeAmount, feeAmountType),
        network: Util.roundReadable(networkFeeAmount, feeAmountType),
        bank: Util.roundReadable(bankFeeAmount, feeAmountType),
      },
      refundAsset,
      refundTarget,
    };
  }

  async getTxStatementDetails(
    userDataId: number,
    txId: number,
    statementType: TxStatementType,
  ): Promise<TxStatementDetails> {
    const transaction = await this.transactionService.getTransactionById(txId, {
      userData: true,
      buyCrypto: { buy: true, cryptoRoute: true, cryptoInput: true },
      buyFiat: { sell: true, cryptoInput: true },
      refReward: { user: { userData: true } },
    });

    if (!transaction || !transaction.targetEntity || transaction.targetEntity instanceof BankTxReturn)
      throw new BadRequestException('Transaction not found');
    if (!transaction.userData.isDataComplete) throw new BadRequestException('User data is not complete');
    if (!transaction.targetEntity.isComplete) throw new BadRequestException('Transaction not completed');
    if (transaction.userData.id !== userDataId) throw new ForbiddenException('Not your transaction');

    if (transaction.buyCrypto && !transaction.buyCrypto.isCryptoCryptoTransaction) {
      const fiat = await this.fiatService.getFiatByName(transaction.buyCrypto.inputAsset);
      return {
        statementType,
        transactionType: TransactionType.BUY,
        transaction,
        currency: fiat.name,
        bankInfo:
          statementType === TxStatementType.INVOICE &&
          (await this.buyService.getBankInfo({
            amount: transaction.buyCrypto.outputAmount,
            currency: fiat.name,
            paymentMethod: transaction.buyCrypto.paymentMethodIn as FiatPaymentMethod,
            userData: transaction.userData,
          })),
      };
    }

    if (transaction.buyFiat) {
      return {
        statementType,
        transactionType: TransactionType.SELL,
        transaction,
        currency: transaction.buyFiat.outputAsset.name,
      };
    }

    if (transaction.buyCrypto && transaction.buyCrypto.isCryptoCryptoTransaction) {
      return {
        statementType,
        transactionType: TransactionType.SWAP,
        transaction,
        currency: await this.getInvoiceCurrency(transaction.userData).then((c) => c.name),
      };
    }

    if (transaction.refReward) {
      return {
        statementType,
        transactionType: TransactionType.REFERRAL,
        transaction,
        currency: await this.getInvoiceCurrency(transaction.userData).then((c) => c.name),
      };
    }

    throw new BadRequestException('Transaction type not supported for invoice generation');
  }

  async getRefundActive(refundEntity: BankTx | BuyCrypto | BuyFiat | BankTxReturn): Promise<Active> {
    if (refundEntity instanceof BankTxReturn) return this.fiatService.getFiatByName(refundEntity.bankTx.currency);
    if (refundEntity instanceof BankTx) return this.fiatService.getFiatByName(refundEntity.currency);
    if (refundEntity instanceof BuyCrypto && refundEntity.bankTx)
      return this.fiatService.getFiatByName(refundEntity.bankTx.currency);

    return refundEntity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(refundEntity.inputAsset));
  }

  private async getAllFees(
    user: User | undefined,
    wallet: Wallet | undefined,
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    bankIn: CardBankName | IbanBankName,
    bankOut: CardBankName | IbanBankName,
    from: Active,
    to: Active,
    txAmountChf: number,
    specialCodes: string[],
    exactPrice: boolean,
    allowCachedBlockchainFee: boolean,
  ): Promise<[InternalFeeDto, number]> {
    const [fee, networkStartFee] = await Promise.all([
      this.getTxFee(
        user,
        wallet,
        paymentMethodIn,
        paymentMethodOut,
        bankIn,
        bankOut,
        from,
        to,
        txAmountChf,
        specialCodes,
        allowCachedBlockchainFee,
      ),
      this.getNetworkStartFee(to, exactPrice, user),
    ]);

    if (exactPrice && user && isAsset(to) && to.blockchain === Blockchain.SOLANA && to.type === AssetType.TOKEN)
      fee.network += await this.getSolanaCreateTokenAccountFee(user, to);

    if (exactPrice && user && isAsset(to) && to.blockchain === Blockchain.TRON)
      fee.network += await this.getTronCreateAccountFee(user, to);

    return [fee, networkStartFee];
  }

  private async getNetworkStartFee(to: Active, exactPrice: boolean, user?: User): Promise<number> {
    if (
      !exactPrice ||
      DisabledProcess(Process.NETWORK_START_FEE) ||
      !isAsset(to) ||
      to.type === AssetType.COIN ||
      !Config.networkStartBlockchains.includes(to.blockchain) ||
      !user
    )
      return 0;

    try {
      const client = this.blockchainRegistryService.getClient(to.blockchain);
      const userBalance = await this.addressBalanceCache.get(`${user.address}-${to.blockchain}`, () =>
        client.getNativeCoinBalanceForAddress(user.address),
      );

      return userBalance < Config.networkStartBalanceLimit ? Config.networkStartFee : 0;
    } catch (e) {
      this.logger.error(`Failed to get network start fee for user ${user.id} on ${to.blockchain}:`, e);
      return 0;
    }
  }

  private async getSolanaCreateTokenAccountFee(user: User, asset: Asset): Promise<number> {
    const solanaService = this.blockchainRegistryService.getService(asset.blockchain) as SolanaService;

    const fee = await solanaService.getCreateTokenAccountFee(user.address, asset);
    if (!fee) return 0;

    const solanaCoin = await this.assetService.getSolanaCoin();

    const price = await this.pricingService.getPrice(solanaCoin, PriceCurrency.CHF, PriceValidity.ANY);
    return price.convert(fee);
  }

  private async getTronCreateAccountFee(user: User, asset: Asset): Promise<number> {
    const tronService = this.blockchainRegistryService.getService(asset.blockchain) as TronService;

    const fee = await tronService.getCreateAccountFee(user.address);
    if (!fee) return 0;

    const tronCoin = await this.assetService.getTronCoin();

    const price = await this.pricingService.getPrice(tronCoin, PriceCurrency.CHF, PriceValidity.ANY);
    return price.convert(fee);
  }

  private async getTxFee(
    user: User | undefined,
    wallet: Wallet | undefined,
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    bankIn: CardBankName | IbanBankName,
    bankOut: CardBankName | IbanBankName,
    from: Active,
    to: Active,
    txVolumeChf: number,
    specialCodes: string[],
    allowCachedBlockchainFee: boolean,
  ): Promise<InternalFeeDto> {
    const feeRequest: UserFeeRequest = {
      user,
      wallet,
      paymentMethodIn,
      paymentMethodOut,
      bankIn,
      bankOut,
      from,
      to,
      txVolume: txVolumeChf,
      specialCodes,
      allowCachedBlockchainFee,
    };

    return user ? this.feeService.getUserFee(feeRequest) : this.feeService.getDefaultFee(feeRequest);
  }

  private async getTargetEstimation(
    inputAmount: number | undefined,
    outputAmount: number | undefined,
    feeRate: number,
    bankFeeRate: number,
    sourceSpecs: TxSpec,
    targetSpecs: TxSpec,
    from: Active,
    to: Active,
    priceValidity: PriceValidity,
  ): Promise<TargetEstimation> {
    const price = await this.pricingService.getPrice(from, to, priceValidity);
    const outputAmountSource = outputAmount && price.invert().convert(outputAmount);

    const sourceAmount = inputAmount ?? this.getInputAmount(outputAmountSource, feeRate, bankFeeRate, sourceSpecs);
    const sourceFees = this.calculateTotalFee(sourceAmount, feeRate, bankFeeRate, sourceSpecs, from);

    const targetAmount = outputAmount ?? price.convert(Math.max(inputAmount - sourceFees.total, 0));
    const targetFees = {
      dfx: this.convertFee(sourceFees.dfx, price, to),
      total: this.convertFee(sourceFees.total, price, to),
      bank: this.convertFee(sourceFees.bank, price, to),
    };

    return {
      timestamp: price.timestamp,
      exchangeRate: Util.roundReadable(price.price, amountType(from)),
      rate: targetAmount ? Util.roundReadable(sourceAmount / targetAmount, amountType(from)) : Number.MAX_VALUE,
      sourceAmount: Util.roundReadable(sourceAmount, amountType(from)),
      estimatedAmount: Util.roundReadable(targetAmount, amountType(to)),
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

  private getInputAmount(
    outputAmount: number,
    rate: number,
    bankRate: number,
    { fee: { min, fixed, network, bankFixed, networkStart } }: TxSpec,
  ): number {
    const inputAmountNormal = (outputAmount + fixed + network + bankFixed + networkStart) / (1 - (rate + bankRate));
    const inputAmountWithMinFee = outputAmount + network + bankFixed + networkStart + min;

    return Math.max(inputAmountNormal, inputAmountWithMinFee);
  }

  // --- HELPER METHODS --- //

  private getDefaultBankByPaymentMethod(paymentMethod: PaymentMethod): CardBankName | IbanBankName {
    switch (paymentMethod) {
      case FiatPaymentMethod.BANK:
        return IbanBankName.MAERKI;
      case FiatPaymentMethod.CARD:
        return CardBankName.CHECKOUT;
      case FiatPaymentMethod.INSTANT:
        return IbanBankName.OLKY;
      default:
        return undefined;
    }
  }

  private async getSourceSpecs(from: Active, { fee, volume }: TxSpec, priceValidity: PriceValidity): Promise<TxSpec> {
    const price = await this.pricingService.getPrice(from, PriceCurrency.CHF, priceValidity).then((p) => p.invert());

    return {
      fee: {
        min: this.convertFee(fee.min, price, from),
        fixed: this.convertFee(fee.fixed, price, from),
        bankFixed: this.convertFee(fee.bankFixed, price, from),
        network: this.convertFee(fee.network, price, from),
        networkStart: fee.networkStart != null ? this.convertFee(fee.networkStart, price, from) : undefined,
      },
      volume: {
        min: this.convert(volume.min, price, from),
        max: this.roundMaxAmount(from.name === 'CHF' ? volume.max : price.convert(volume.max * 0.99), isFiat(from)), // -1% for the conversion
      },
    };
  }

  private async getTargetSpecs(to: Active, { fee, volume }: TxSpec, priceValidity: PriceValidity): Promise<TxSpec> {
    const price = await this.pricingService.getPrice(PriceCurrency.CHF, to, priceValidity);

    return {
      fee: {
        min: this.convertFee(fee.min, price, to),
        fixed: this.convertFee(fee.fixed, price, to),
        bankFixed: this.convertFee(fee.bankFixed, price, to),
        network: this.convertFee(fee.network, price, to),
        networkStart: fee.networkStart != null ? this.convertFee(fee.networkStart, price, to) : undefined,
      },
      volume: {
        min: this.convert(volume.min, price, to),
        max: this.roundMaxAmount(to.name === 'CHF' ? volume.max : price.convert(volume.max * 0.99), isFiat(to)), // -1% for the conversion
      },
    };
  }

  private calculateTotalFee(
    amount: number,
    rate: number,
    bankRate: number,
    { fee: { fixed, min, network, networkStart, bankFixed } }: TxSpec,
    roundingActive: Active,
  ): { dfx: number; bank: number; total: number } {
    const bank = amount * bankRate + bankFixed;
    const dfx = Math.max(amount * rate + fixed, min);
    const total = dfx + bank + network + (networkStart ?? 0);

    return {
      dfx: Util.roundReadable(dfx, feeAmountType(roundingActive)),
      bank: Util.roundReadable(bank, feeAmountType(roundingActive)),
      total: Util.roundReadable(total, feeAmountType(roundingActive)),
    };
  }

  private convert(amount: number, price: Price, roundingActive: Active): number {
    const targetAmount = price.convert(amount);
    return Util.roundReadable(targetAmount, amountType(roundingActive));
  }

  private convertFee(amount: number, price: Price, roundingActive: Active): number {
    const targetAmount = price.convert(amount);
    return Util.roundReadable(targetAmount, feeAmountType(roundingActive));
  }

  private roundMaxAmount(amount: number, isFiat: boolean): number {
    return isFiat ? Util.round(amount, -1) : Util.roundByPrecision(amount, 3);
  }

  private async getLimits(
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    user?: User,
  ): Promise<{ kycLimit: number; defaultLimit: number }> {
    const volume30d =
      user?.userData.kycLevel < KycLevel.LEVEL_50
        ? await this.user30dVolumeCache.get(user.id.toString(), () =>
            this.getVolumeSince(Util.daysBefore(30), Util.daysAfter(30), [user]),
          )
        : 0;

    const kycLimit = (user?.userData.availableTradingLimit ?? Number.MAX_VALUE) - volume30d;

    const defaultLimit = [paymentMethodIn, paymentMethodOut].includes(FiatPaymentMethod.CARD)
      ? Config.tradingLimits.cardDefault
      : Config.tradingLimits.yearlyDefault;

    return { kycLimit: Math.max(0, kycLimit), defaultLimit };
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
    ibanCountry?: string,
  ): QuoteError | undefined {
    const nationality = user?.userData.nationality;
    const isBuy = isFiat(from) && isAsset(to);
    const isSell = isAsset(from) && isFiat(to);
    const isSwap = isAsset(from) && isAsset(to);

    if (
      user?.wallet.amlRuleList.includes(AmlRule.SKIP_AML_CHECK) &&
      [Environment.LOC, Environment.DEV].includes(Config.environment)
    )
      return;

    if (!DisabledProcess(Process.TRADE_APPROVAL_DATE) && user?.userData && !user.userData.tradeApprovalDate)
      return QuoteError.TRADING_NOT_ALLOWED;

    // Credit card payments disabled
    if (paymentMethodIn === FiatPaymentMethod.CARD) return QuoteError.PAYMENT_METHOD_NOT_ALLOWED;

    if (isSell && ibanCountry && !to.isIbanCountryAllowed(ibanCountry)) return QuoteError.IBAN_CURRENCY_MISMATCH;

    if (
      nationality &&
      ((isBuy && !nationality.bankEnable) || ((isSell || isSwap) && !nationality.cryptoEnable))
    )
      return QuoteError.NATIONALITY_NOT_ALLOWED;

    // KYC checks
    const amlRuleError = AmlHelperService.amlRuleQuoteCheck(
      [from.amlRuleFrom, to.amlRuleTo, nationality?.amlRule],
      user?.wallet.exceptAmlRuleList,
      user,
      paymentMethodIn,
    );
    if (amlRuleError) return amlRuleError;

    const walletAmlRuleError =
      isBuy &&
      AmlHelperService.amlRuleQuoteCheck(
        user?.wallet.amlRuleList,
        user?.wallet.exceptAmlRuleList,
        user,
        paymentMethodIn,
      );
    if (walletAmlRuleError) return walletAmlRuleError;

    if (isSwap && user?.userData.kycLevel < KycLevel.LEVEL_30 && user?.userData.status !== UserDataStatus.ACTIVE)
      return QuoteError.KYC_REQUIRED;

    if ((isSell || isSwap) && user?.userData.kycLevel < KycLevel.LEVEL_30 && from.dexName === 'XMR')
      return QuoteError.KYC_REQUIRED;

    if (paymentMethodIn === FiatPaymentMethod.INSTANT && user && !user.userData.olkypayAllowed)
      return QuoteError.KYC_REQUIRED_INSTANT;

    if (isSell && user && !user.userData.isDataComplete) return QuoteError.KYC_DATA_REQUIRED;

    // limit checks
    if (user && txAmountChf > kycLimitChf) return QuoteError.LIMIT_EXCEEDED;

    // verification checks
    if (
      txAmountChf > Config.tradingLimits.monthlyDefaultWoKyc &&
      user?.userData?.accountType === AccountType.ORGANIZATION &&
      user?.userData?.identificationType === KycIdentificationType.ONLINE_ID
    )
      return QuoteError.VIDEO_IDENT_REQUIRED;

    if (
      ((isSell && to.name !== 'CHF') || isSwap) &&
      user &&
      !user.userData.hasBankTxVerification &&
      txAmountChf > Config.tradingLimits.monthlyDefaultWoKyc
    )
      return QuoteError.BANK_TRANSACTION_OR_VIDEO_MISSING;

    // amount checks
    if (txAmountChf < minAmountChf) return QuoteError.AMOUNT_TOO_LOW;
    if (txAmountChf > maxAmountChf) return QuoteError.AMOUNT_TOO_HIGH;
  }

  private async getInvoiceCurrency(userData: UserData): Promise<Fiat> {
    const preferredCurrency = userData.currency.name;
    const allowedCurrency = Config.invoice.currencies.includes(preferredCurrency)
      ? preferredCurrency
      : Config.invoice.defaultCurrency;
    const currency = await this.fiatService.getFiatByName(allowedCurrency);
    if (!currency) throw new BadRequestException('Preferred currency not found');

    return currency;
  }
}
