import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Config } from 'src/config/config';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { TransactionStatus } from 'src/integration/sift/dto/sift.dto';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { CustodyOrderType } from 'src/subdomains/core/custody/enums/custody';
import { CustodyOrderService } from 'src/subdomains/core/custody/services/custody-order.service';
import { HistoryDtoDeprecated, PaymentStatusMapper } from 'src/subdomains/core/history/dto/history.dto';
import {
  BankTxRefund,
  CheckoutTxRefund,
  CryptoInputRefund,
  RefundInternalDto,
} from 'src/subdomains/core/history/dto/refund-internal.dto';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { TransactionDetailsDto } from 'src/subdomains/core/statistic/dto/statistic.dto';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { BankDataType } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { FiatOutputType } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import { CheckoutTxService } from 'src/subdomains/supporting/fiat-payin/services/checkout-tx.service';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { UpdateTransactionInternalDto } from 'src/subdomains/supporting/payment/dto/input/update-transaction-internal.dto';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionTypeInternal } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { Between, FindOptionsRelations, In, IsNull, MoreThan, Not } from 'typeorm';
import { AmlReason } from '../../../aml/enums/aml-reason.enum';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { Buy } from '../../routes/buy/buy.entity';
import { BuyRepository } from '../../routes/buy/buy.repository';
import { BuyService } from '../../routes/buy/buy.service';
import { BuyHistoryDto } from '../../routes/buy/dto/buy-history.dto';
import { UpdateBuyCryptoDto } from '../dto/update-buy-crypto.dto';
import { BuyCrypto, BuyCryptoEditableAmlCheck } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { BuyCryptoWebhookService } from './buy-crypto-webhook.service';

@Injectable()
export class BuyCryptoService {
  private readonly logger = new DfxLogger(BuyCryptoService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyRepo: BuyRepository,
    @Inject(forwardRef(() => BuyFiatService))
    private readonly buyFiatService: BuyFiatService,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    @Inject(forwardRef(() => BuyService))
    private readonly buyService: BuyService,
    @Inject(forwardRef(() => SwapService))
    private readonly swapService: SwapService,
    private readonly userService: UserService,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly bankDataService: BankDataService,
    private readonly transactionRequestService: TransactionRequestService,
    private readonly transactionService: TransactionService,
    @Inject(forwardRef(() => CheckoutTxService))
    private readonly checkoutTxService: CheckoutTxService,
    private readonly siftService: SiftService,
    private readonly specialExternalAccountService: SpecialExternalAccountService,
    private readonly checkoutService: CheckoutService,
    @Inject(forwardRef(() => PayInService))
    private readonly payInService: PayInService,
    private readonly fiatOutputService: FiatOutputService,
    @Inject(forwardRef(() => TransactionUtilService))
    private readonly transactionUtilService: TransactionUtilService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    @Inject(forwardRef(() => AmlService))
    private readonly amlService: AmlService,
    @Inject(forwardRef(() => TransactionHelper))
    private readonly transactionHelper: TransactionHelper,
    private readonly custodyOrderService: CustodyOrderService,
  ) {}

  async createFromBankTx(bankTx: BankTx, buyId: number): Promise<void> {
    let entity = await this.buyCryptoRepo.findOneBy({ bankTx: { id: bankTx.id } });
    if (entity) throw new ConflictException('There is already a buy-crypto for the specified bank TX');

    const buy = await this.getBuy(buyId);

    const forexFee = bankTx.txCurrency === bankTx.currency ? 0 : Config.bank.forexFee;

    // create bank data
    if (bankTx.senderAccount && !DisabledProcess(Process.AUTO_CREATE_BANK_DATA)) {
      const bankData = await this.bankDataService.getVerifiedBankDataWithIban(bankTx.senderAccount, buy.userData.id);

      if (!bankData) {
        const multiAccounts = await this.specialExternalAccountService.getMultiAccounts();
        const bankDataName = bankTx.bankDataName(multiAccounts);
        if (bankDataName)
          await this.bankDataService.createVerifyBankData(buy.userData, {
            name: bankDataName,
            iban: bankTx.senderAccount,
            bic: bankTx.bic,
            type: BankDataType.BANK_IN,
          });
      }
    }

    // create entity
    entity = this.buyCryptoRepo.create({
      bankTx,
      buy,
      inputAmount: bankTx.txAmount,
      inputAsset: bankTx.txCurrency,
      inputReferenceAmount: (bankTx.amount + bankTx.chargeAmount) * (1 - forexFee),
      inputReferenceAsset: bankTx.currency,
      transaction: { id: bankTx.transaction.id },
    });

    await this.createEntity(entity, {
      type: TransactionTypeInternal.BUY_CRYPTO,
      user: buy.user,
      userData: buy.userData,
      resetMailSendDate: true,
    });
  }

  async createFromCheckoutTx(checkoutTx: CheckoutTx, buy: Buy): Promise<void> {
    let entity = await this.buyCryptoRepo.findOneBy({ checkoutTx: { id: checkoutTx.id } });
    if (entity) throw new ConflictException('There is already a buy-crypto for the specified checkout TX');

    // create bank data
    if (checkoutTx.cardFingerPrint && !DisabledProcess(Process.AUTO_CREATE_BANK_DATA)) {
      const bankData = await this.bankDataService.getVerifiedBankDataWithIban(
        checkoutTx.cardFingerPrint,
        buy.userData.id,
      );

      if (!bankData)
        await this.bankDataService.createVerifyBankData(buy.userData, {
          name: checkoutTx.cardName ?? buy.userData.completeName ?? buy.userData.verifiedName,
          iban: checkoutTx.cardFingerPrint,
          type: BankDataType.CARD_IN,
        });
    }

    // create entity
    entity = this.buyCryptoRepo.create({
      checkoutTx,
      buy,
      inputAmount: checkoutTx.amount,
      inputAsset: checkoutTx.currency,
      inputReferenceAmount: checkoutTx.amount,
      inputReferenceAsset: checkoutTx.currency,
      transaction: { id: checkoutTx.transaction.id },
    });

    await this.createEntity(entity, {
      type: TransactionTypeInternal.BUY_CRYPTO,
      user: buy.user,
      userData: buy.userData,
    });
  }

  async createFromCryptoInput(cryptoInput: CryptoInput, swap: Swap, request?: TransactionRequest): Promise<BuyCrypto> {
    // create entity
    const entity = this.buyCryptoRepo.create({
      cryptoInput,
      cryptoRoute: swap,
      inputAmount: cryptoInput.amount,
      inputAsset: cryptoInput.asset.name,
      inputReferenceAmount: cryptoInput.amount,
      inputReferenceAsset: cryptoInput.asset.name,
      transaction: { id: cryptoInput.transaction.id },
    });

    return this.createEntity(
      entity,
      {
        type: TransactionTypeInternal.CRYPTO_CRYPTO,
        user: swap.user,
        userData: swap.userData,
      },
      request,
    );
  }

  async update(id: number, dto: UpdateBuyCryptoDto): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne({
      where: { id },
      relations: {
        buy: true,
        cryptoRoute: true,
        cryptoInput: true,
        bankTx: true,
        checkoutTx: true,
        transaction: { user: { wallet: true }, userData: { users: true } },
        chargebackOutput: true,
        bankData: true,
      },
    });
    if (!entity) throw new NotFoundException('Buy-crypto not found');

    const buyIdBefore = entity.buy?.id;
    const cryptoRouteIdBefore = entity.cryptoRoute?.id;
    const usedRefBefore = entity.usedRef;

    const update = this.buyCryptoRepo.create(dto);

    // chargeback bank tx
    if (dto.chargebackBankTxId) {
      update.chargebackBankTx = await this.bankTxService.getBankTxRepo().findOneBy({ id: dto.chargebackBankTxId });
      if (!update.chargebackBankTx) throw new BadRequestException('Bank TX not found');
    }

    // buy
    if (dto.buyId) {
      if (!entity.buy) throw new BadRequestException(`Cannot assign buy-crypto ${id} to a buy route`);
      update.buy = await this.getBuy(dto.buyId);
      if (entity.bankTx) await this.bankTxService.getBankTxRepo().setNewUpdateTime(entity.bankTx.id);
    }

    // crypto route
    if (dto.cryptoRouteId) {
      if (!entity.cryptoRoute) throw new BadRequestException(`Cannot assign buy-crypto ${id} to a crypto route`);
      update.cryptoRoute = await this.getCryptoRoute(dto.cryptoRouteId);
      if (entity.bankTx) await this.bankTxService.getBankTxRepo().setNewUpdateTime(entity.bankTx.id);
    }

    if (dto.outputAssetId) {
      update.outputAsset = await this.assetService.getAssetById(dto.outputAssetId);
      if (!update.outputAsset) throw new BadRequestException('Asset not found');
    }

    if (dto.outputReferenceAssetId) {
      update.outputReferenceAsset = await this.assetService.getAssetById(dto.outputReferenceAssetId);
      if (!update.outputReferenceAsset) throw new BadRequestException('Asset not found');
    }

    if (dto.bankDataId && !entity.bankData) {
      update.bankData = await this.bankDataService.getBankData(dto.bankDataId);
      if (!update.bankData) throw new NotFoundException('BankData not found');
    }

    if ((dto.bankDataApproved != null || dto.bankDataManualApproved != null) && (update.bankData || entity.bankData))
      await this.bankDataService.updateBankData(update.bankData?.id ?? entity.bankData.id, {
        approved: dto.bankDataApproved,
        manualApproved: dto.bankDataManualApproved,
      });

    if (dto.chargebackAllowedDate) {
      if (entity.bankTx && !entity.chargebackOutput)
        update.chargebackOutput = await this.fiatOutputService.createInternal(
          FiatOutputType.BUY_CRYPTO_FAIL,
          { buyCrypto: entity },
          entity.id,
        );

      if (entity.checkoutTx) {
        await this.refundCheckoutTx(entity, { chargebackAllowedDate: new Date(), chargebackAllowedBy: 'GS' });
        Object.assign(dto, { isComplete: true, chargebackDate: new Date() });
      }
    }

    if (dto.chargebackIban && entity.amlCheck === CheckStatus.FAIL) entity.mailSendDate = null;

    update.amlReason = update.amlCheck === CheckStatus.PASS ? AmlReason.NA : update.amlReason;

    const forceUpdate: Partial<BuyCrypto> = {
      ...((BuyCryptoEditableAmlCheck.includes(entity.amlCheck) ||
        (entity.amlCheck === CheckStatus.FAIL && dto.amlCheck === CheckStatus.GSHEET)) &&
      !entity.isComplete &&
      (update?.amlCheck !== entity.amlCheck || update.amlReason !== entity.amlReason)
        ? { amlCheck: update.amlCheck, mailSendDate: null, amlReason: update.amlReason, comment: update.comment }
        : undefined),
      isComplete: dto.isComplete,
    };

    const amlCheckBefore = entity.amlCheck;

    entity = await this.buyCryptoRepo.save(
      Object.assign(new BuyCrypto(), {
        ...update,
        ...Util.removeNullFields(entity),
        ...forceUpdate,
        fee: entity.fee,
      }),
    );

    if (forceUpdate.amlCheck || (!amlCheckBefore && update.amlCheck)) {
      if (update.amlCheck === CheckStatus.PASS) {
        await this.buyCryptoNotificationService.paymentProcessing(entity);

        const inputReferenceCurrency =
          entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputReferenceAsset));

        const last30dVolume = await this.transactionHelper.getVolumeChfSince(
          entity,
          entity.userData.users,
          Util.daysBefore(30, entity.transaction.created),
          Util.daysAfter(30, entity.transaction.created),
          PriceValidity.VALID_ONLY,
          undefined,
          undefined,
          inputReferenceCurrency,
        );

        await this.amlService.postProcessing(entity, amlCheckBefore, last30dVolume);
      } else {
        await this.amlService.postProcessing(entity, amlCheckBefore, undefined);
      }
    }

    // create sift transaction
    if (forceUpdate.amlCheck === CheckStatus.FAIL)
      await this.siftService.buyCryptoTransaction(entity, TransactionStatus.FAILURE);

    // payment webhook
    if (
      dto.isComplete ||
      (dto.amlCheck && dto.amlCheck !== CheckStatus.PASS) ||
      dto.outputReferenceAssetId ||
      dto.chargebackDate
    )
      await this.buyCryptoWebhookService.triggerWebhook(entity);

    if (dto.amountInChf) await this.updateBuyVolume([buyIdBefore, entity.buy?.id]);
    if (dto.amountInChf) await this.updateCryptoRouteVolume([cryptoRouteIdBefore, entity.cryptoRoute?.id]);
    if (dto.usedRef || dto.amountInEur) await this.updateRefVolume([usedRefBefore, entity.usedRef]);

    return entity;
  }

  async refundBuyCrypto(buyCryptoId: number, dto: RefundInternalDto): Promise<void> {
    const buyCrypto = await this.buyCryptoRepo.findOne({
      where: { id: buyCryptoId },
      relations: {
        bankTx: true,
        checkoutTx: true,
        cryptoInput: { route: { user: true }, transaction: true },
        transaction: { userData: true },
      },
    });

    if (!buyCrypto) throw new NotFoundException('BuyCrypto not found');
    if (buyCrypto.checkoutTx)
      return this.refundCheckoutTx(buyCrypto, {
        chargebackAllowedDate: dto.chargebackAllowedDate,
        chargebackAllowedBy: dto.chargebackAllowedBy,
      });
    if (buyCrypto.cryptoInput)
      return this.refundCryptoInput(buyCrypto, {
        refundUserId: dto.refundUser?.id,
        chargebackAmount: dto.chargebackAmount,
        chargebackAllowedDate: dto.chargebackAllowedDate,
        chargebackAllowedBy: dto.chargebackAllowedBy,
      });

    return this.refundBankTx(buyCrypto, {
      refundIban: dto.refundIban,
      chargebackAmount: dto.chargebackAmount,
      chargebackAllowedDate: dto.chargebackAllowedDate,
      chargebackAllowedBy: dto.chargebackAllowedBy,
    });
  }

  async refundCheckoutTx(buyCrypto: BuyCrypto, dto: CheckoutTxRefund): Promise<void> {
    const chargebackAmount = dto.chargebackAmount ?? buyCrypto.chargebackAmount ?? buyCrypto.inputAmount;

    TransactionUtilService.validateRefund(buyCrypto, { chargebackAmount });

    if (dto.chargebackAllowedDate && chargebackAmount) {
      dto.chargebackRemittanceInfo = await this.checkoutService.refundPayment(buyCrypto.checkoutTx.paymentId);
      await this.checkoutTxService.paymentRefunded(buyCrypto.checkoutTx.id);
    }

    await this.buyCryptoRepo.update(
      ...buyCrypto.chargebackFillUp(
        undefined,
        chargebackAmount,
        dto.chargebackAllowedDate,
        dto.chargebackAllowedDateUser,
        dto.chargebackAllowedBy,
        undefined,
        dto.chargebackRemittanceInfo?.reference,
      ),
    );
  }

  async refundCryptoInput(buyCrypto: BuyCrypto, dto: CryptoInputRefund): Promise<void> {
    if (!dto.refundUserAddress && !dto.refundUserId && !buyCrypto.chargebackIban)
      throw new BadRequestException('You have to define a chargebackAddress');

    const refundUser = dto.refundUserId
      ? await this.userService.getUser(dto.refundUserId, { userData: true, wallet: true })
      : await this.userService.getUserByAddress(dto.refundUserAddress ?? buyCrypto.chargebackIban, {
          userData: true,
          wallet: true,
        });

    const chargebackAmount = dto.chargebackAmount ?? buyCrypto.chargebackAmount;

    TransactionUtilService.validateRefund(buyCrypto, { refundUser, chargebackAmount });

    let blockchainFee: number;
    if (dto.chargebackAllowedDate && chargebackAmount) {
      blockchainFee = await this.transactionHelper.getBlockchainFee(buyCrypto.cryptoInput.asset, true);
      await this.payInService.returnPayIn(
        buyCrypto.cryptoInput,
        refundUser.address ?? buyCrypto.chargebackIban,
        chargebackAmount,
      );
    }

    await this.buyCryptoRepo.update(
      ...buyCrypto.chargebackFillUp(
        refundUser.address ?? buyCrypto.chargebackIban,
        chargebackAmount,
        dto.chargebackAllowedDate,
        dto.chargebackAllowedDateUser,
        dto.chargebackAllowedBy,
        undefined,
        undefined,
        blockchainFee,
      ),
    );
  }

  async refundBankTx(buyCrypto: BuyCrypto, dto: BankTxRefund): Promise<void> {
    const timeArray = [Date.now()];

    if (!dto.refundIban && !buyCrypto.chargebackIban)
      throw new BadRequestException('You have to define a chargebackIban');

    const chargebackAmount = dto.chargebackAmount ?? buyCrypto.chargebackAmount;
    const chargebackIban = dto.refundIban ?? buyCrypto.chargebackIban;

    TransactionUtilService.validateRefund(buyCrypto, {
      refundIban: chargebackIban,
      chargebackAmount,
    });

    if (
      !(await this.transactionUtilService.validateChargebackIban(
        chargebackIban,
        chargebackIban !== buyCrypto.bankTx.iban,
      ))
    )
      throw new BadRequestException('IBAN not valid or BIC not available');

    timeArray.push(Date.now());

    if (dto.chargebackAllowedDate && chargebackAmount)
      dto.chargebackOutput = await this.fiatOutputService.createInternal(
        FiatOutputType.BUY_CRYPTO_FAIL,
        { buyCrypto },
        buyCrypto.id,
      );

    await this.buyCryptoRepo.update(
      ...buyCrypto.chargebackFillUp(
        chargebackIban,
        chargebackAmount,
        dto.chargebackAllowedDate,
        dto.chargebackAllowedDateUser,
        dto.chargebackAllowedBy,
        dto.chargebackOutput,
        buyCrypto.chargebackBankRemittanceInfo,
      ),
    );

    timeArray.push(Date.now());

    this.logger.info(`Refund bankTx time log: ${Util.createTimeString(timeArray)}`);
  }

  async delete(buyCrypto: BuyCrypto): Promise<void> {
    if (buyCrypto.fee) await this.buyCryptoRepo.deleteFee(buyCrypto.fee);
    await this.buyCryptoRepo.delete(buyCrypto.id);
  }

  async getBuyCryptoByKeys(keys: string[], value: any, onlyDefaultRelation = false): Promise<BuyCrypto> {
    const query = this.buyCryptoRepo
      .createQueryBuilder('buyCrypto')
      .select('buyCrypto')
      .leftJoinAndSelect('buyCrypto.transaction', 'transaction')
      .leftJoinAndSelect('transaction.userData', 'userData');

    for (const key of keys) {
      query.orWhere(`${key.includes('.') ? key : `buyCrypto.${key}`} = :param`, { param: value });
    }

    if (!onlyDefaultRelation) {
      query.leftJoinAndSelect('buyCrypto.buy', 'buy');
      query.leftJoinAndSelect('buyCrypto.cryptoRoute', 'cryptoRoute');
      query.leftJoinAndSelect('userData.users', 'users');
      query.leftJoinAndSelect('userData.kycSteps', 'kycSteps');
      query.leftJoinAndSelect('userData.country', 'country');
      query.leftJoinAndSelect('userData.nationality', 'nationality');
      query.leftJoinAndSelect('userData.organizationCountry', 'organizationCountry');
      query.leftJoinAndSelect('userData.language', 'language');
      query.leftJoinAndSelect('users.wallet', 'wallet');
    }

    return query.getOne();
  }

  async getBuyCryptoByTransactionId(
    transactionId: number,
    relations?: FindOptionsRelations<BuyCrypto>,
  ): Promise<BuyCrypto> {
    return this.buyCryptoRepo.findOne({ where: { transaction: { id: transactionId } }, relations });
  }

  async getBuyCrypto(from: Date, relations?: FindOptionsRelations<BuyCrypto>): Promise<BuyCrypto[]> {
    return this.buyCryptoRepo.find({ where: { transaction: { created: MoreThan(from) } }, relations });
  }

  async updateVolumes(start = 1, end = 100000): Promise<void> {
    const buyCryptos = await this.buyCryptoRepo.find({
      where: { id: Between(start, end) },
      relations: { buy: true, cryptoRoute: true },
    });

    const buyIds = buyCryptos.filter((b) => b.buy).map((b) => b.buy.id);
    const cryptoRouteIds = buyCryptos.filter((b) => b.cryptoRoute).map((b) => b.cryptoRoute.id);

    await this.updateBuyVolume([...new Set(buyIds)]);
    await this.updateCryptoRouteVolume([...new Set(cryptoRouteIds)]);
  }

  async updateRefVolumes(start = 1, end = 100000): Promise<void> {
    const refs = await this.buyCryptoRepo
      .createQueryBuilder('buyCrypto')
      .select('usedRef')
      .groupBy('usedRef')
      .where('buyCrypto.id BETWEEN :start AND :end', { start, end })
      .getRawMany<{ usedRef: string }>()
      .then((refs) => refs.map((r) => r.usedRef));

    await this.updateRefVolume([...new Set(refs)]);
  }

  async resetAmlCheck(id: number): Promise<void> {
    const entity = await this.buyCryptoRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('BuyCrypto not found');
    if (entity.isComplete || entity.batch || entity.chargebackOutput?.isComplete)
      throw new BadRequestException('BuyCrypto is already complete or payout initiated');
    if (!entity.amlCheck) throw new BadRequestException('BuyCrypto AML check is not set');

    const fee = entity.fee;
    const fiatOutputId = entity.chargebackOutput?.id;

    await this.buyCryptoRepo.update(...entity.resetAmlCheck());
    if (fee) await this.buyCryptoRepo.deleteFee(fee);
    if (fiatOutputId) await this.fiatOutputService.delete(fiatOutputId);
  }

  async getUserVolume(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
    excludedId?: number,
    type?: 'cryptoInput' | 'checkoutTx' | 'bankTx',
  ): Promise<number> {
    if (type) return this.getUserVolumeForType(userIds, dateFrom, dateTo, excludedId, type);

    const volumes = await Promise.all([
      this.getUserVolumeForType(userIds, dateFrom, dateTo, excludedId, 'cryptoInput'),
      this.getUserVolumeForType(userIds, dateFrom, dateTo, excludedId, 'checkoutTx'),
      this.getUserVolumeForType(userIds, dateFrom, dateTo, excludedId, 'bankTx'),
    ]);

    return Util.sum(volumes);
  }

  private async getUserVolumeForType(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
    excludedId: number | undefined,
    type: 'cryptoInput' | 'checkoutTx' | 'bankTx',
  ): Promise<number> {
    const request = this.buyCryptoRepo.createQueryBuilder('buyCrypto').select('SUM(amountInChf)', 'volume');

    switch (type) {
      case 'cryptoInput':
        request
          .innerJoin('buyCrypto.cryptoRoute', 'route')
          .innerJoin('buyCrypto.cryptoInput', 'cryptoInput')
          .where('cryptoInput.created BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo });
        break;

      case 'checkoutTx':
        request
          .innerJoin('buyCrypto.buy', 'route')
          .innerJoin('buyCrypto.checkoutTx', 'checkoutTx')
          .where('checkoutTx.requestedOn BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo });
        break;

      case 'bankTx':
        request
          .innerJoin('buyCrypto.buy', 'route')
          .innerJoin('buyCrypto.bankTx', 'bankTx')
          .where('bankTx.created BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo });
        break;
    }

    request
      .andWhere('buyCrypto.amlCheck != :amlCheck', { amlCheck: CheckStatus.FAIL })
      .andWhere('route.userId IN (:...userIds)', { userIds });

    if (excludedId) request.andWhere('buyCrypto.id != :excludedId', { excludedId });

    return request.getRawOne<{ volume: number }>().then((result) => result.volume ?? 0);
  }

  async getRefTransactions(
    refCodes: string[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    return this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes), outputDate: Between(dateFrom, dateTo) },
      relations: {
        bankTx: true,
        checkoutTx: true,
        cryptoInput: true,
        buy: { user: true },
        cryptoRoute: { user: true },
      },
    });
  }

  async getBuyHistory(userId: number, buyId?: number): Promise<BuyHistoryDto[]> {
    const where = Util.removeNullFields({ user: { id: userId }, id: buyId });
    return this.buyCryptoRepo
      .find({
        where: { buy: where },
        relations: { buy: { user: true } },
      })
      .then((buyCryptos) => buyCryptos.map(this.toHistoryDto));
  }

  async getCryptoHistory(userId: number, routeId?: number): Promise<HistoryDtoDeprecated[]> {
    const where = Util.removeNullFields({ user: { id: userId }, id: routeId });
    return this.buyCryptoRepo
      .find({
        where: { cryptoRoute: where },
        relations: { cryptoRoute: { user: true } },
      })
      .then((history) => history.map(this.toHistoryDto));
  }

  async getPendingTransactions(): Promise<BuyCrypto[]> {
    return this.buyCryptoRepo.find({
      where: { isComplete: false },
      relations: { cryptoInput: true, checkoutTx: true, bankTx: true },
    });
  }

  // --- HELPER METHODS --- //

  private async createEntity(
    entity: BuyCrypto,
    dto: UpdateTransactionInternalDto,
    request?: TransactionRequest,
  ): Promise<BuyCrypto> {
    entity.outputAsset = entity.outputReferenceAsset = entity.buy?.asset ?? entity.cryptoRoute.asset;

    // transaction
    request = await this.getAndCompleteTxRequest(entity, request);
    entity.transaction = await this.transactionService.updateInternal(entity.transaction, { ...dto, request });

    entity = await this.buyCryptoRepo.save(entity);

    if (dto.user.role === UserRole.CUSTODY || request?.custodyOrder) {
      if (request?.custodyOrder) {
        await this.custodyOrderService.updateCustodyOrderInternal(request.custodyOrder, {
          transaction: entity.transaction,
        });
      } else {
        await this.custodyOrderService.createOrderInternal({
          type: entity.isCryptoCryptoTransaction ? CustodyOrderType.RECEIVE : CustodyOrderType.DEPOSIT,
          user: dto.user,
          transaction: entity.transaction,
          transactionRequest: request,
          buy: entity.buy,
          swap: entity.cryptoRoute,
        });
      }
    }

    await this.buyCryptoWebhookService.triggerWebhook(entity);

    return entity;
  }

  private async getAndCompleteTxRequest(entity: BuyCrypto, request?: TransactionRequest): Promise<TransactionRequest> {
    if (request) {
      await this.transactionRequestService.complete(request.id);
    } else {
      const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));

      request = await this.transactionRequestService.findAndComplete(
        entity.inputAmount,
        entity.route.id,
        inputCurrency.id,
        entity.outputAsset.id,
      );
    }

    return request;
  }

  private toHistoryDto(buyCrypto: BuyCrypto): HistoryDtoDeprecated {
    return {
      inputAmount: buyCrypto.inputAmount,
      inputAsset: buyCrypto.inputAsset,
      amlCheck: buyCrypto.amlCheck,
      outputAmount: buyCrypto.outputAmount,
      outputAsset: buyCrypto.outputAsset?.dexName,
      txId: buyCrypto.txId,
      txUrl:
        buyCrypto.outputAsset && buyCrypto.txId
          ? txExplorerUrl(buyCrypto.outputAsset.blockchain, buyCrypto.txId)
          : undefined,
      isComplete: buyCrypto.isComplete,
      date: buyCrypto.outputDate,
      status: PaymentStatusMapper[buyCrypto.status],
    };
  }

  private async getBuy(buyId: number): Promise<Buy> {
    // buy
    const buy = await this.buyRepo.findOne({
      where: { id: buyId },
      relations: { user: { wallet: true, userData: { bankDatas: true } } },
    });
    if (!buy) throw new BadRequestException('Buy route not found');

    return buy;
  }

  private async getCryptoRoute(cryptoRouteId: number): Promise<Swap> {
    // cryptoRoute
    const cryptoRoute = await this.swapService
      .getSwapRepo()
      .findOne({ where: { id: cryptoRouteId }, relations: { user: { wallet: true } } });
    if (!cryptoRoute) throw new BadRequestException('Crypto route not found');

    return cryptoRoute;
  }

  async updateBuyVolume(buyIds: number[]): Promise<void> {
    buyIds = buyIds.filter((u, j) => buyIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of buyIds) {
      const { volume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInChf)', 'volume')
        .where('buyId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: CheckStatus.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInChf)', 'annualVolume')
        .leftJoin('buyCrypto.bankTx', 'bankTx')
        .where('buyCrypto.buyId = :id', { id: id })
        .andWhere('buyCrypto.amlCheck = :check', { check: CheckStatus.PASS })
        .andWhere('bankTx.bookingDate >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.buyService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  async updateCryptoRouteVolume(cryptoRouteIds: number[]): Promise<void> {
    cryptoRouteIds = cryptoRouteIds.filter((u, j) => cryptoRouteIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of cryptoRouteIds) {
      const { volume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInChf)', 'volume')
        .where('cryptoRouteId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: CheckStatus.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInChf)', 'annualVolume')
        .leftJoin('buyCrypto.cryptoInput', 'cryptoInput')
        .where('buyCrypto.cryptoRouteId = :id', { id: id })
        .andWhere('buyCrypto.amlCheck = :check', { check: CheckStatus.PASS })
        .andWhere('cryptoInput.created >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.swapService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  async updateRefVolume(refs: string[]): Promise<void> {
    refs = refs.filter((u, j) => refs.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const ref of refs) {
      const { volume: buyCryptoVolume, credit: buyCryptoCredit } = await this.getRefVolume(ref);
      const { volume: buyFiatVolume, credit: buyFiatCredit } = await this.buyFiatService.getRefVolume(ref);
      const { volume: manualVolume, credit: manualCredit } = await this.transactionService.getManualRefVolume(ref);

      await this.userService.updateRefVolume(
        ref,
        buyCryptoVolume + buyFiatVolume + manualVolume,
        buyCryptoCredit + buyFiatCredit + manualCredit,
      );
    }
  }

  async getRefVolume(ref: string): Promise<{ volume: number; credit: number }> {
    const { volume, credit } = await this.buyCryptoRepo
      .createQueryBuilder('buyCrypto')
      .select('SUM(amountInEur * refFactor)', 'volume')
      .addSelect('SUM(amountInEur * refFactor * refProvision * 0.01)', 'credit')
      .where('usedRef = :ref', { ref })
      .andWhere('amlCheck = :check', { check: CheckStatus.PASS })
      .getRawOne<{ volume: number; credit: number }>();

    return { volume: volume ?? 0, credit: credit ?? 0 };
  }

  // Admin Support Tool methods

  async getAllRefTransactions(refCodes: string[]): Promise<BuyCrypto[]> {
    return this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes) },
      relations: {
        bankTx: true,
        checkoutTx: true,
        cryptoInput: true,
        buy: { user: true },
        cryptoRoute: { user: true },
      },
      order: { id: 'DESC' },
    });
  }

  async getAllUserTransactions(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    return this.buyCryptoRepo.find({
      where: [
        { buy: { user: { id: In(userIds) } }, bankTx: { created: Between(dateFrom, dateTo) } },
        { buy: { user: { id: In(userIds) } }, checkoutTx: { created: Between(dateFrom, dateTo) } },
        { cryptoRoute: { user: { id: In(userIds) } }, cryptoInput: { created: Between(dateFrom, dateTo) } },
      ],
      relations: {
        bankTx: true,
        buy: { user: true },
        cryptoInput: true,
        checkoutTx: true,
        cryptoRoute: { user: true },
        chargebackBankTx: true,
        bankData: true,
      },
      order: { id: 'DESC' },
    });
  }

  // Statistics
  async getTransactions(dateFrom: Date = new Date(0), dateTo: Date = new Date()): Promise<TransactionDetailsDto[]> {
    const buyCryptos = await this.buyCryptoRepo.find({
      where: { buy: { id: Not(IsNull()) }, outputDate: Between(dateFrom, dateTo), amlCheck: CheckStatus.PASS },
      relations: { buy: true },
      loadEagerRelations: false,
    });

    return buyCryptos.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.buy?.asset?.name,
    }));
  }
}
