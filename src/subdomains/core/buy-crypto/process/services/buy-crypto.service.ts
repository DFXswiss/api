import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { CheckoutPaymentStatus } from 'src/integration/checkout/dto/checkout.dto';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import {
  SiftAssetType,
  SiftPaymentMethodMap,
  Transaction,
  TransactionStatus,
  TransactionType,
} from 'src/integration/sift/dto/sift.dto';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { HistoryDtoDeprecated, PaymentStatusMapper } from 'src/subdomains/core/history/dto/history.dto';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { TransactionDetailsDto } from 'src/subdomains/core/statistic/dto/statistic.dto';
import { BankDataType } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.entity';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.service';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import { CheckoutTxService } from 'src/subdomains/supporting/fiat-payin/services/checkout-tx.service';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { TransactionTypeInternal } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { Between, Brackets, In, IsNull, Not } from 'typeorm';
import { AmlReason } from '../../../aml/enums/aml-reason.enum';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { Buy } from '../../routes/buy/buy.entity';
import { BuyRepository } from '../../routes/buy/buy.repository';
import { BuyService } from '../../routes/buy/buy.service';
import { BuyHistoryDto } from '../../routes/buy/dto/buy-history.dto';
import { UpdateBuyCryptoDto } from '../dto/update-buy-crypto.dto';
import { BuyCrypto, BuyCryptoEditableAmlCheck } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoWebhookService } from './buy-crypto-webhook.service';

@Injectable()
export class BuyCryptoService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyRepo: BuyRepository,
    @Inject(forwardRef(() => BuyFiatService))
    private readonly buyFiatService: BuyFiatService,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly buyService: BuyService,
    private readonly swapService: SwapService,
    private readonly userService: UserService,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly bankDataService: BankDataService,
    private readonly transactionRequestService: TransactionRequestService,
    private readonly transactionService: TransactionService,
    private readonly checkoutTxService: CheckoutTxService,
    private readonly siftService: SiftService,
    private readonly checkoutService: CheckoutService,
  ) {}

  async createFromBankTx(bankTx: BankTx, buyId: number): Promise<void> {
    let entity = await this.buyCryptoRepo.findOneBy({ bankTx: { id: bankTx.id } });
    if (entity) throw new ConflictException('There is already a buy-crypto for the specified bank TX');

    const buy = await this.getBuy(buyId);

    const transaction = await this.transactionService.update(bankTx.transaction.id, {
      type: TransactionTypeInternal.BUY_CRYPTO,
      user: buy.user,
      resetMailSendDate: true,
    });

    const forexFee = bankTx.txCurrency === bankTx.currency ? 0 : 0.02;

    // create bank data
    if (bankTx.senderAccount && !DisabledProcess(Process.AUTO_CREATE_BANK_DATA)) {
      const bankData = await this.bankDataService.getBankDataWithIban(bankTx.senderAccount, buy.user.userData.id);

      if (!bankData)
        await this.bankDataService.createBankData(buy.user.userData, {
          iban: bankTx.senderAccount,
          type: BankDataType.BANK_IN,
        });
    }

    // create entity
    entity = this.buyCryptoRepo.create({
      bankTx,
      buy,
      inputAmount: bankTx.txAmount,
      inputAsset: bankTx.txCurrency,
      inputReferenceAmount: (bankTx.amount + bankTx.chargeAmount) * (1 - forexFee),
      inputReferenceAsset: bankTx.currency,
      transaction,
    });

    await this.createEntity(entity, {
      $account_holder_name: bankTx.name,
      $shortened_iban_first6: bankTx.iban.slice(0, 6),
      $shortened_iban_last4: bankTx.iban.slice(-4),
      $bank_name: bankTx.bankName,
      $bank_country: bankTx.country,
      $routing_number: bankTx.aba,
    });
  }

  async createFromCheckoutTx(checkoutTx: CheckoutTx, buy: Buy): Promise<void> {
    let entity = await this.buyCryptoRepo.findOneBy({ checkoutTx: { id: checkoutTx.id } });
    if (entity) throw new ConflictException('There is already a buy-crypto for the specified checkout TX');

    const transaction = await this.transactionService.update(checkoutTx.transaction.id, {
      type: TransactionTypeInternal.BUY_CRYPTO,
      user: buy.user,
    });

    // create bank data
    if (checkoutTx.cardFingerPrint && !DisabledProcess(Process.AUTO_CREATE_BANK_DATA)) {
      const bankData = await this.bankDataService.getBankDataWithIban(checkoutTx.cardFingerPrint, buy.user.userData.id);

      if (!bankData)
        await this.bankDataService.createBankData(buy.user.userData, {
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
      transaction,
    });

    await this.createEntity(entity, {
      $account_holder_name: checkoutTx.cardName,
      $card_bin: checkoutTx.cardBin,
      $card_last4: checkoutTx.cardLast4,
      $bank_name: checkoutTx.cardIssuer,
      $bank_country: checkoutTx.cardIssuerCountry,
    });
  }

  async createFromCryptoInput(cryptoInput: CryptoInput, swap: Swap): Promise<void> {
    const transaction = await this.transactionService.update(cryptoInput.transaction.id, {
      type: TransactionTypeInternal.CRYPTO_CRYPTO,
      user: swap.user,
    });

    // create entity
    const entity = this.buyCryptoRepo.create({
      cryptoInput,
      cryptoRoute: swap,
      inputAmount: cryptoInput.amount,
      inputAsset: cryptoInput.asset.name,
      inputReferenceAmount: cryptoInput.amount,
      inputReferenceAsset: cryptoInput.asset.name,
      transaction,
    });

    await this.createEntity(entity, {});
  }

  private async createEntity(
    entity: BuyCrypto,
    paymentMethod: {
      $account_holder_name?: string;
      $card_bin?: string;
      $card_last4?: string;
      $shortened_iban_first6?: string;
      $shortened_iban_last4?: string;
      $bank_name?: string;
      $bank_country?: string;
      $routing_number?: string;
    },
  ) {
    entity.outputAsset = entity.target.asset;
    entity.outputReferenceAsset = entity.outputAsset.type === AssetType.CUSTOM ? null : entity.outputAsset;

    entity = await this.setTxRequest(entity);

    entity = await this.buyCryptoRepo.save(entity);

    //create sift transaction
    await this.siftService.transaction({
      $transaction_id: entity.id.toString(),
      $transaction_type: TransactionType.BUY,
      $transaction_status: TransactionStatus.PENDING,
      $order_id: entity.transactionRequest?.id.toString(),
      $user_id: entity.user.id.toString(),
      $time: entity.created.getTime(),
      $amount: entity.inputAmount * 10000,
      $currency_code: entity.inputAsset,
      $site_country: 'CH',
      $payment_methods: [
        {
          $payment_type: SiftPaymentMethodMap[entity.paymentMethodIn],
          ...paymentMethod,
        },
      ],
      $digital_orders: [
        {
          $digital_asset: entity.outputAsset.name,
          $pair: `${entity.inputAsset}_${entity.outputAsset.name}`,
          $asset_type: SiftAssetType.CRYPTO,
          $volume: entity.outputAmount?.toString(),
        },
      ],
      blockchain: entity.outputAsset.blockchain,
    } as Transaction);

    await this.buyCryptoWebhookService.triggerWebhook(entity);
  }

  private async setTxRequest(entity: BuyCrypto): Promise<BuyCrypto> {
    const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));

    const transactionRequest = await this.transactionRequestService.findAndComplete(
      entity.inputAmount,
      entity.route.id,
      inputCurrency.id,
      entity.target.asset.id,
    );
    if (transactionRequest) {
      entity.transactionRequest = transactionRequest;
      entity.externalTransactionId = transactionRequest.externalTransactionId;
    }

    return entity;
  }

  async update(id: number, dto: UpdateBuyCryptoDto): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne({
      where: { id },
      relations: {
        buy: { user: { userData: true, wallet: true } },
        cryptoRoute: { user: { userData: true, wallet: true } },
        cryptoInput: true,
        bankTx: true,
        checkoutTx: true,
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

    // chargeback checkout tx
    if (dto.chargebackCheckoutTxId) {
      update.chargebackCheckoutTx = await this.checkoutTxService.getCheckoutTx(dto.chargebackCheckoutTxId);
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

    Util.removeNullFields(entity);
    const fee = entity.fee;

    update.amlReason = update.amlCheck === CheckStatus.PASS ? AmlReason.NA : update.amlReason;

    const forceUpdate: Partial<BuyCrypto> = {
      ...(BuyCryptoEditableAmlCheck.includes(entity.amlCheck) &&
      !entity.isComplete &&
      (update?.amlCheck !== entity.amlCheck || update.amlReason !== entity.amlReason)
        ? { amlCheck: update.amlCheck, mailSendDate: null, amlReason: update.amlReason, comment: update.comment }
        : undefined),
      isComplete: dto.isComplete,
    };

    entity = await this.buyCryptoRepo.save(
      Object.assign(new BuyCrypto(), {
        ...update,
        ...entity,
        ...forceUpdate,
        fee,
      }),
    );

    // activate user
    if (entity.amlCheck === CheckStatus.PASS && entity.buy?.user) {
      await this.userService.activateUser(entity.buy.user);
    }

    // update sift transaction status
    if (forceUpdate.amlCheck === CheckStatus.FAIL)
      await this.siftService.transaction({
        $transaction_id: entity.id.toString(),
        $transaction_status: TransactionStatus.FAILURE,
        $time: entity.updated.getTime(),
      } as Transaction);

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

  async returnBuyCrypto(buyCryptoId: number): Promise<void> {
    const buyCrypto = await this.buyCryptoRepo.findOne({ where: { id: buyCryptoId }, relations: { checkoutTx: true } });
    if (!buyCrypto.checkoutTx) throw new BadRequestException('Return is only supported with checkoutTx');

    const chargebackRemittanceInfo = await this.checkoutService.reversePayment(buyCrypto.checkoutTx.paymentId);

    buyCrypto.chargebackDate = new Date();
    buyCrypto.chargebackRemittanceInfo = JSON.stringify(chargebackRemittanceInfo);

    buyCrypto.checkoutTx.status = CheckoutPaymentStatus.REFUNDED_PENDING;

    await this.checkoutTxService.save(buyCrypto.checkoutTx);
    await this.buyCryptoRepo.save(buyCrypto);
  }

  async delete(buyCrypto: BuyCrypto): Promise<void> {
    if (buyCrypto.fee) await this.buyCryptoRepo.deleteFee(buyCrypto.fee);
    await this.buyCryptoRepo.delete(buyCrypto.id);
  }

  async getBuyCryptoByKey(key: string, value: any): Promise<BuyCrypto> {
    return this.buyCryptoRepo
      .createQueryBuilder('buyCrypto')
      .select('buyCrypto')
      .leftJoinAndSelect('buyCrypto.buy', 'buy')
      .leftJoinAndSelect('buyCrypto.cryptoRoute', 'cryptoRoute')
      .leftJoinAndSelect('buy.user', 'user')
      .leftJoinAndSelect('cryptoRoute.user', 'cryptoRouteUser')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('cryptoRouteUser.userData', 'cryptoRouteUserData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .leftJoinAndSelect('cryptoRouteUserData.users', 'cryptoRouteUsers')
      .leftJoinAndSelect('cryptoRouteUsers.wallet', 'cryptoRouteWallet')
      .where(`${key.includes('.') ? key : `buyCrypto.${key}`} = :param`, { param: value })
      .getOne();
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
    if (entity.isComplete || entity.batch)
      throw new BadRequestException('BuyCrypto is already complete or payout initiated');
    if (!entity.amlCheck) throw new BadRequestException('BuyCrypto AML check is not set');

    const fee = entity.fee;

    await this.buyCryptoRepo.update(...entity.resetAmlCheck());
    if (fee) await this.buyCryptoRepo.deleteFee(fee);
  }

  async getUserTransactions(
    userId: number,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    return this.buyCryptoRepo.find({
      where: [
        { buy: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo) },
        { buy: { user: { id: userId } }, outputDate: IsNull() },
        { cryptoRoute: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo) },
        { cryptoRoute: { user: { id: userId } }, outputDate: IsNull() },
      ],
      relations: ['bankTx', 'checkoutTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
    });
  }

  async getUserVolume(userIds: number[], dateFrom: Date = new Date(0), dateTo: Date = new Date()): Promise<number> {
    return this.buyCryptoRepo
      .createQueryBuilder('buyCrypto')
      .select('SUM(amountInChf)', 'volume')
      .leftJoin('buyCrypto.bankTx', 'bankTx')
      .leftJoin('buyCrypto.cryptoInput', 'cryptoInput')
      .leftJoin('buyCrypto.checkoutTx', 'checkoutTx')
      .leftJoin('buyCrypto.buy', 'buy')
      .leftJoin('buyCrypto.cryptoRoute', 'cryptoRoute')
      .where(
        new Brackets((query) =>
          query
            .where('buy.userId IN (:...userIds)', { userIds })
            .orWhere('cryptoRoute.userId IN (:...userIds)', { userIds }),
        ),
      )
      .andWhere(
        new Brackets((query) =>
          query
            .where('bankTx.created BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
            .orWhere('cryptoInput.created BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
            .orWhere('checkoutTx.requestedOn BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo }),
        ),
      )
      .andWhere('buyCrypto.amlCheck != :amlCheck', { amlCheck: CheckStatus.FAIL })
      .getRawOne<{ volume: number }>()
      .then((result) => result.volume ?? 0);
  }

  async getRefTransactions(
    refCodes: string[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    return this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes), outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'checkoutTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
    });
  }

  async getBuyHistory(userId: number, buyId?: number): Promise<BuyHistoryDto[]> {
    const where = { user: { id: userId }, id: buyId };
    Util.removeNullFields(where);
    return this.buyCryptoRepo
      .find({
        where: { buy: where },
        relations: ['buy', 'buy.user'],
      })
      .then((buyCryptos) => buyCryptos.map(this.toHistoryDto));
  }

  async getCryptoHistory(userId: number, routeId?: number): Promise<HistoryDtoDeprecated[]> {
    const where = { user: { id: userId }, id: routeId };
    Util.removeNullFields(where);
    return this.buyCryptoRepo
      .find({
        where: { cryptoRoute: where },
        relations: ['cryptoRoute', 'cryptoRoute.user'],
      })
      .then((history) => history.map(this.toHistoryDto));
  }

  // --- HELPER METHODS --- //

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
      .findOne({ where: { id: cryptoRouteId }, relations: ['user', 'user.wallet'] });
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

      await this.userService.updateRefVolume(ref, buyCryptoVolume + buyFiatVolume, buyCryptoCredit + buyFiatCredit);
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
      relations: ['bankTx', 'checkoutTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
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
        { buy: { user: { id: In(userIds) } }, bankTx: { created: Between(dateFrom, dateTo) }, transaction: true },
        { buy: { user: { id: In(userIds) } }, checkoutTx: { created: Between(dateFrom, dateTo) }, transaction: true },
        {
          cryptoRoute: { user: { id: In(userIds) } },
          cryptoInput: { created: Between(dateFrom, dateTo) },
          transaction: true,
        },
      ],
      relations: [
        'bankTx',
        'buy',
        'buy.user',
        'cryptoInput',
        'checkoutTx',
        'cryptoRoute',
        'cryptoRoute.user',
        'chargebackBankTx',
        'chargebackCheckoutTx',
      ],
      order: { id: 'DESC' },
    });
  }

  // Statistics

  async getTransactions(dateFrom: Date = new Date(0), dateTo: Date = new Date()): Promise<TransactionDetailsDto[]> {
    const buyCryptos = await this.buyCryptoRepo.find({
      where: { buy: { id: Not(IsNull()) }, outputDate: Between(dateFrom, dateTo), amlCheck: CheckStatus.PASS },
      relations: ['buy', 'buy.asset'],
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
