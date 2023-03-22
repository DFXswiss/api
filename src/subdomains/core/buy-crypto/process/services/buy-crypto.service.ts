import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { Between, In, IsNull, Not } from 'typeorm';
import { Util } from 'src/shared/utils/util';
import { Lock } from 'src/shared/utils/lock';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { UpdateBuyCryptoDto } from '../dto/update-buy-crypto.dto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyCryptoBatchService } from './buy-crypto-batch.service';
import { BuyCryptoOutService } from './buy-crypto-out.service';
import { BuyCryptoDexService } from './buy-crypto-dex.service';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { AmlCheck } from '../enums/aml-check.enum';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { CryptoRouteService } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.service';
import { HistoryDto } from 'src/subdomains/core/history/dto/history.dto';
import { BuyHistoryDto } from '../../routes/buy/dto/buy-history.dto';
import { BankTxService } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/buy-fiat.service';
import { BuyCryptoRegistrationService } from './buy-crypto-registration.service';
import { Buy } from '../../routes/buy/buy.entity';
import { BuyRepository } from '../../routes/buy/buy.repository';
import { BuyService } from '../../routes/buy/buy.service';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { PaymentWebhookState } from 'src/subdomains/generic/user/services/webhook/dto/payment-webhook.dto';
import { TransactionDetailsDto } from 'src/subdomains/core/statistic/dto/statistic.dto';
import { BlockchainExplorerUrls } from 'src/integration/blockchain/shared/enums/blockchain.enum';

@Injectable()
export class BuyCryptoService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyRepo: BuyRepository,
    @Inject(forwardRef(() => BuyFiatService))
    private readonly buyFiatService: BuyFiatService,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly settingService: SettingService,
    private readonly buyService: BuyService,
    private readonly cryptoRouteService: CryptoRouteService,
    private readonly buyCryptoBatchService: BuyCryptoBatchService,
    private readonly buyCryptoOutService: BuyCryptoOutService,
    private readonly buyCryptoDexService: BuyCryptoDexService,
    private readonly buyCryptoRegistrationService: BuyCryptoRegistrationService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly userService: UserService,
    private readonly webhookService: WebhookService,
  ) {}

  async createFromFiat(bankTxId: number, buyId: number): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne({ bankTx: { id: bankTxId } });
    if (entity) throw new ConflictException('There is already a buy crypto for the specified bank TX');

    entity = this.buyCryptoRepo.create();

    // bank tx
    entity.bankTx = await this.bankTxService.getBankTxRepo().findOne(bankTxId);
    if (!entity.bankTx) throw new BadRequestException('Bank TX not found');

    // buy
    if (buyId) entity.buy = await this.getBuy(buyId);

    return this.buyCryptoRepo.save(entity);
  }

  async update(id: number, dto: UpdateBuyCryptoDto): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne(id, {
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
    if (!entity) throw new NotFoundException('Buy crypto not found');

    const buyIdBefore = entity.buy?.id;
    const cryptoRouteIdBefore = entity.cryptoRoute?.id;
    const usedRefBefore = entity.usedRef;

    const update = this.buyCryptoRepo.create(dto);

    // chargeback bank tx
    if (dto.chargebackBankTxId) {
      update.chargebackBankTx = await this.bankTxService.getBankTxRepo().findOne({ id: dto.chargebackBankTxId });
      if (!update.chargebackBankTx) throw new BadRequestException('Bank TX not found');
    }

    // buy
    if (dto.buyId) {
      if (!entity.buy) throw new BadRequestException(`Cannot assign BuyCrypto ${id} to a buy route`);
      update.buy = await this.getBuy(dto.buyId);
      if (entity.bankTx) await this.bankTxService.getBankTxRepo().setNewUpdateTime(entity.bankTx.id);
    }

    // crypto route
    if (dto.cryptoRouteId) {
      if (!entity.cryptoRoute) throw new BadRequestException(`Cannot assign BuyCrypto ${id} to a crypto route`);
      update.cryptoRoute = await this.getCryptoRoute(dto.cryptoRouteId);
      if (entity.bankTx) await this.bankTxService.getBankTxRepo().setNewUpdateTime(entity.bankTx.id);
    }

    Util.removeNullFields(entity);

    const amlUpdate =
      entity.amlCheck === AmlCheck.PENDING && update.amlCheck && update.amlCheck !== AmlCheck.PENDING
        ? { amlCheck: update.amlCheck, mailSendDate: null }
        : undefined;
    entity = await this.buyCryptoRepo.save(Object.assign(new BuyCrypto(), { ...update, ...entity, ...amlUpdate }));

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
    if ((await this.settingService.get('crypto-crypto')) !== 'on') return;

    await this.buyCryptoRegistrationService.registerCryptoPayIn();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async process() {
    if ((await this.settingService.get('buy-process')) !== 'on') return;

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
          ? `${BlockchainExplorerUrls[buyCrypto.outputAsset.blockchain]}/${buyCrypto.txId}`
          : undefined,
      isComplete: buyCrypto.isComplete,
      date: buyCrypto.outputDate,
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

  async getAllUserTransactions(userIds: number[]): Promise<BuyCrypto[]> {
    return this.buyCryptoRepo.find({
      where: [{ buy: { user: { id: In(userIds) } } }, { cryptoRoute: { user: { id: In(userIds) } } }],
      relations: ['bankTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
      order: { id: 'DESC' },
    });
  }

  // Statistics

  async getTransactions(dateFrom: Date = new Date(0), dateTo: Date = new Date()): Promise<TransactionDetailsDto[]> {
    // TODO Add cryptoInput buyCryptos, consultation with Daniel regarding statistic data
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
