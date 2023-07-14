import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TransactionSpecificationRepository } from 'src/shared/payment/repositories/transaction-specification.repository';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { CryptoRouteService } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.service';
import { HistoryDto, PaymentStatusMapper } from 'src/subdomains/core/history/dto/history.dto';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/buy-fiat.service';
import { TransactionDetailsDto } from 'src/subdomains/core/statistic/dto/statistic.dto';
import { BankDataRepository } from 'src/subdomains/generic/user/models/bank-data/bank-data.repository';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PaymentWebhookState } from 'src/subdomains/generic/user/services/webhook/dto/payment-webhook.dto';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { BankTxService } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.service';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { Between, In, IsNull, Not } from 'typeorm';
import { Buy } from '../../routes/buy/buy.entity';
import { BuyRepository } from '../../routes/buy/buy.repository';
import { BuyService } from '../../routes/buy/buy.service';
import { BuyHistoryDto } from '../../routes/buy/dto/buy-history.dto';
import { UpdateBuyCryptoDto } from '../dto/update-buy-crypto.dto';
import { BuyCrypto, BuyCryptoEditableAmlCheck } from '../entities/buy-crypto.entity';
import { AmlCheck } from '../enums/aml-check.enum';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatchService } from './buy-crypto-batch.service';
import { BuyCryptoDexService } from './buy-crypto-dex.service';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { BuyCryptoOutService } from './buy-crypto-out.service';
import { BuyCryptoRegistrationService } from './buy-crypto-registration.service';

@Injectable()
export class BuyCryptoService {
  private readonly logger = new DfxLogger(BuyCryptoNotificationService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyRepo: BuyRepository,
    @Inject(forwardRef(() => BuyFiatService))
    private readonly buyFiatService: BuyFiatService,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly buyService: BuyService,
    private readonly cryptoRouteService: CryptoRouteService,
    private readonly buyCryptoBatchService: BuyCryptoBatchService,
    private readonly buyCryptoOutService: BuyCryptoOutService,
    private readonly buyCryptoDexService: BuyCryptoDexService,
    private readonly buyCryptoRegistrationService: BuyCryptoRegistrationService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly userService: UserService,
    private readonly webhookService: WebhookService,
    private readonly transactionSpecificationRepo: TransactionSpecificationRepository,
    private readonly priceProviderService: PriceProviderService,
    private readonly fiatService: FiatService,
    private readonly bankDataRepo: BankDataRepository,
  ) {}

  async createFromFiat(bankTxId: number, buyId: number): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOneBy({ bankTx: { id: bankTxId } });
    if (entity) throw new ConflictException('There is already a buy-crypto for the specified bank TX');

    entity = this.buyCryptoRepo.create();

    // bank tx
    entity.bankTx = await this.bankTxService.getBankTxRepo().findOneBy({ id: bankTxId });
    if (!entity.bankTx) throw new BadRequestException('Bank TX not found');

    // buy
    if (buyId) entity.buy = await this.getBuy(buyId);

    return this.buyCryptoRepo.save(entity);
  }

  async update(id: number, dto: UpdateBuyCryptoDto): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne({
      where: { id },
      relations: [
        'buy',
        'buy.user',
        'buy.user.wallet',
        'buy.user.userData',
        'cryptoRoute',
        'cryptoRoute.user',
        'cryptoRoute.user.wallet',
        'bankTx',
      ],
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

    Util.removeNullFields(entity);
    const fee = entity.fee;
    if (dto.allowedTotalFeePercent && entity.fee) fee.allowedTotalFeePercent = dto.allowedTotalFeePercent;

    const forceUpdate = {
      ...(BuyCryptoEditableAmlCheck.includes(entity.amlCheck) &&
      update.amlCheck &&
      !BuyCryptoEditableAmlCheck.includes(update.amlCheck)
        ? { amlCheck: update.amlCheck, mailSendDate: null }
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
    if (entity.amlCheck === AmlCheck.PASS && entity.buy?.user) {
      await this.userService.activateUser(entity.buy.user);
    }

    // payment webhook
    if (dto.inputAmount && dto.inputAsset) {
      entity.buy
        ? await this.webhookService.fiatCryptoUpdate(entity.user, entity, PaymentWebhookState.CREATED)
        : await this.webhookService.cryptoCryptoUpdate(entity.user, entity, PaymentWebhookState.CREATED);
    }

    await this.updateBuyVolume([buyIdBefore, entity.buy?.id]);
    await this.updateCryptoRouteVolume([cryptoRouteIdBefore, entity.cryptoRoute?.id]);
    await this.updateRefVolume([usedRefBefore, entity.usedRef]);

    return entity;
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
      .leftJoinAndSelect('users.wallet', 'wallet')
      .leftJoinAndSelect('cryptoRouteUserData.users', 'cryptoRouteUsers')
      .leftJoinAndSelect('cryptoRouteUsers.wallet', 'cryptoRouteWallet')
      .where(`buyCrypto.${key} = :param`, { param: value })
      .getOne();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async checkCryptoPayIn() {
    if (Config.processDisabled(Process.BUY_CRYPTO)) return;
    await this.buyCryptoRegistrationService.registerCryptoPayIn();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async process() {
    if (Config.processDisabled(Process.BUY_CRYPTO)) return;
    await this.saveAmlCheck();
    await this.buyCryptoBatchService.prepareTransactions();
    await this.buyCryptoBatchService.batchAndOptimizeTransactions();
    await this.buyCryptoDexService.secureLiquidity();
    await this.buyCryptoOutService.payoutTransactions();
    await this.buyCryptoNotificationService.sendNotificationMails();
  }

  async updateVolumes(): Promise<void> {
    const buyIds = await this.buyRepo.find().then((l) => l.map((b) => b.id));
    await this.updateBuyVolume(buyIds);
  }

  async updateRefVolumes(): Promise<void> {
    const refs = await this.buyCryptoRepo
      .createQueryBuilder('buyCrypto')
      .select('usedRef')
      .groupBy('usedRef')
      .getRawMany<{ usedRef: string }>();
    await this.updateRefVolume(refs.map((r) => r.usedRef));
  }

  async getUserTransactions(
    userId: number,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    return this.buyCryptoRepo.find({
      where: [
        { buy: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo) },
        { cryptoRoute: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo) },
      ],
      relations: ['bankTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
    });
  }

  async getRefTransactions(
    refCodes: string[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    return this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes), outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
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

  async getCryptoHistory(userId: number, routeId?: number): Promise<HistoryDto[]> {
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

  private async saveAmlCheck() {
    const entities = await this.buyCryptoRepo.find({
      where: { amlCheck: IsNull(), amlReason: IsNull(), bankTx: Not(IsNull()) },
      relations: ['bankTx', 'buy', 'buy.user', 'buy.user.userData', 'buy.user.userData.users'],
    });

    const assetSpecifications = await this.transactionSpecificationRepo.find({ where: { system: Not('Fiat') } });

    this.logger.verbose(
      `AmlCheck for ${entities.length} buy-crypto transaction(s). Transaction ID(s): ${entities.map((t) => t.id)}`,
    );

    // CHF/EUR Price
    const fiatEur = await this.fiatService.getFiatByName('EUR');
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    for (const entity of entities) {
      const blockchainSpecification = assetSpecifications.filter(
        (blockchain) => blockchain.system === entity.target.asset.blockchain,
      )[0];

      const inputCurrency = await this.fiatService.getFiatByName(entity.bankTx.txCurrency);

      const inputAssetEurPrice = await this.priceProviderService.getPrice(inputCurrency, fiatEur);
      const inputAssetChfPrice = await this.priceProviderService.getPrice(inputCurrency, fiatChf);

      const eurChfPrice = await this.priceProviderService.getPrice(fiatEur, fiatChf);

      const inputAmountEur = inputAssetEurPrice.convert(entity.bankTx.txAmount);
      const inputAmountChf = inputAssetChfPrice.convert(entity.bankTx.txAmount);

      const bankData = await this.bankDataRepo.findOne({
        where: { iban: entity.bankTx.iban, active: true },
        relations: ['userData'],
      });

      const dateFrom = Util.daysBefore(30);
      const userDataTransactions = (
        await this.getAllUserTransactions(
          entity.user.userData.users.map((user) => user.id),
          dateFrom,
        )
      ).filter((buyCrypto) => buyCrypto.amlCheck === AmlCheck.PASS && buyCrypto.bankTx);

      await this.buyCryptoRepo.update(
        ...entity.fiatAmlCheck(
          inputAmountEur,
          blockchainSpecification.minVolume,
          Util.sumObj(userDataTransactions, 'amountInEur'),
          bankData.userData,
        ),
      );

      if (entity.amlCheck === AmlCheck.PASS)
        await this.buyCryptoRepo.update(
          ...entity.fillUp(
            inputAmountChf,
            inputAmountEur,
            inputAssetEurPrice.invert().convert(blockchainSpecification.minVolume),
            eurChfPrice.convert(blockchainSpecification.minVolume),
          ),
        );
    }
  }

  private toHistoryDto(buyCrypto: BuyCrypto): HistoryDto {
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
    const buy = await this.buyRepo.findOne({ where: { id: buyId }, relations: ['user', 'user.wallet'] });
    if (!buy) throw new BadRequestException('Buy route not found');

    return buy;
  }

  private async getCryptoRoute(cryptoRouteId: number): Promise<CryptoRoute> {
    // cryptoRoute
    const cryptoRoute = await this.cryptoRouteService
      .getCryptoRouteRepo()
      .findOne({ where: { id: cryptoRouteId }, relations: ['user', 'user.wallet'] });
    if (!cryptoRoute) throw new BadRequestException('Crypto route not found');

    return cryptoRoute;
  }

  private async updateBuyVolume(buyIds: number[]): Promise<void> {
    buyIds = buyIds.filter((u, j) => buyIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of buyIds) {
      const { volume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur)', 'volume')
        .where('buyId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur)', 'annualVolume')
        .leftJoin('buyCrypto.bankTx', 'bankTx')
        .where('buyCrypto.buyId = :id', { id: id })
        .andWhere('buyCrypto.amlCheck = :check', { check: AmlCheck.PASS })
        .andWhere('bankTx.bookingDate >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.buyService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  private async updateCryptoRouteVolume(cryptoRouteIds: number[]): Promise<void> {
    cryptoRouteIds = cryptoRouteIds.filter((u, j) => cryptoRouteIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of cryptoRouteIds) {
      const { volume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur)', 'volume')
        .where('cryptoRouteId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur)', 'annualVolume')
        .leftJoin('buyCrypto.cryptoInput', 'cryptoInput')
        .where('buyCrypto.cryptoRouteId = :id', { id: id })
        .andWhere('buyCrypto.amlCheck = :check', { check: AmlCheck.PASS })
        .andWhere('cryptoInput.created >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.cryptoRouteService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  private async updateRefVolume(refs: string[]): Promise<void> {
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
      .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
      .getRawOne<{ volume: number; credit: number }>();

    return { volume: volume ?? 0, credit: credit ?? 0 };
  }

  // Admin Support Tool methods

  async getAllRefTransactions(refCodes: string[]): Promise<BuyCrypto[]> {
    return this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes) },
      relations: ['bankTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
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
        { buy: { user: { id: In(userIds) } }, outputDate: Between(dateFrom, dateTo) },
        { cryptoRoute: { user: { id: In(userIds) } }, outputDate: Between(dateFrom, dateTo) },
      ],
      relations: ['bankTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
      order: { id: 'DESC' },
    });
  }

  // Statistics

  async getTransactions(dateFrom: Date = new Date(0), dateTo: Date = new Date()): Promise<TransactionDetailsDto[]> {
    const buyCryptos = await this.buyCryptoRepo.find({
      where: { buy: { id: Not(IsNull()) }, outputDate: Between(dateFrom, dateTo), amlCheck: AmlCheck.PASS },
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
