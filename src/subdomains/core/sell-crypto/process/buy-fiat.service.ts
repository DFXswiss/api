import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BuyFiat } from './buy-fiat.entity';
import { BuyFiatRepository } from './buy-fiat.repository';
import { Sell } from '../route/sell.entity';
import { Between, In, IsNull } from 'typeorm';
import { UpdateBuyFiatDto } from './dto/update-buy-fiat.dto';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { SellRepository } from '../route/sell.repository';
import { SellService } from '../route/sell.service';
import { SellHistoryDto } from '../route/dto/sell-history.dto';
import { AmlCheck } from '../../buy-crypto/process/enums/aml-check.enum';
import { BankTxService } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.service';
import { FiatOutputService } from '../../../supporting/bank/fiat-output/fiat-output.service';
import { Lock } from 'src/shared/utils/lock';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BuyCryptoService } from '../../buy-crypto/process/services/buy-crypto.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyFiatRegistrationService } from './buy-fiat-registration.service';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { PaymentWebhookState } from 'src/subdomains/generic/user/services/webhook/dto/payment-webhook.dto';
import { TransactionDetailsDto } from '../../statistic/dto/statistic.dto';
import { BlockchainExplorerUrls } from 'src/integration/blockchain/shared/enums/blockchain.enum';

@Injectable()
export class BuyFiatService {
  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatRegistrationService: BuyFiatRegistrationService,
    private readonly userService: UserService,
    private readonly sellRepo: SellRepository,
    private readonly sellService: SellService,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly fiatOutputService: FiatOutputService,
    private readonly settingService: SettingService,
    private readonly webhookService: WebhookService,
  ) {}

  private readonly outputsLock = new Lock(7200);
  private readonly registerLock = new Lock(1800);

  // --- CHECK BUY FIAT --- //
  @Cron(CronExpression.EVERY_10_MINUTES)
  async addFiatOutputs(): Promise<void> {
    if (!this.outputsLock.acquire()) return;

    try {
      const buyFiatsWithoutOutput = await this.buyFiatRepo.find({
        relations: ['fiatOutput'],
        where: { amlCheck: AmlCheck.PASS, fiatOutput: IsNull() },
      });

      for (const buyFiat of buyFiatsWithoutOutput) {
        await this.fiatOutputService.create({
          buyFiatId: buyFiat.id,
          type: 'BuyFiat',
        });
      }
    } catch (e) {
      console.error('Exception during adding fiat outputs:', e);
    } finally {
      this.outputsLock.release();
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkCryptoPayIn() {
    if ((await this.settingService.get('sell-crypto')) !== 'on') return;
    if (!this.registerLock.acquire()) return;

    try {
      await this.buyFiatRegistrationService.registerSellPayIn();
    } catch (e) {
      console.error('Error during sell-crypto pay-in registration', e);
    } finally {
      this.registerLock.release();
    }
  }

  async update(id: number, dto: UpdateBuyFiatDto): Promise<BuyFiat> {
    let entity = await this.buyFiatRepo.findOne(id, { relations: ['sell', 'sell.user', 'sell.user.wallet'] });
    if (!entity) throw new NotFoundException('Buy fiat not found');

    const sellIdBefore = entity.sell?.id;
    const usedRefBefore = entity.usedRef;

    const update = this.buyFiatRepo.create(dto);

    // buy
    if (dto.sellId) update.sell = await this.getSell(dto.sellId);

    // bank tx
    if (dto.bankTxId) {
      update.bankTx = await this.bankTxService.getBankTxRepo().findOne({ id: dto.bankTxId });
      if (!update.bankTx) throw new BadRequestException('Bank TX not found');
      await this.bankTxService.getBankTxRepo().setNewUpdateTime(dto.bankTxId);
    }

    Util.removeNullFields(entity);

    const amlUpdate =
      entity.amlCheck === AmlCheck.PENDING && update.amlCheck && update.amlCheck !== AmlCheck.PENDING
        ? { amlCheck: update.amlCheck, mail2SendDate: null, mailReturnSendDate: null }
        : undefined;
    entity = await this.buyFiatRepo.save({ ...update, ...entity, ...amlUpdate });

    // activate user
    if (entity.amlCheck === AmlCheck.PASS) {
      await this.userService.activateUser(entity.sell?.user);
    }

    // payment webhook
    // TODO add fiatFiatUpdate here
    if (dto.outputAmount && dto.outputAsset) {
      entity.sell
        ? await this.webhookService.cryptoFiatUpdate(entity.sell.user, entity, PaymentWebhookState.COMPLETED)
        : null;
    } else if (dto.inputAmount && dto.inputAsset) {
      entity.sell
        ? await this.webhookService.cryptoFiatUpdate(entity.sell.user, entity, PaymentWebhookState.CREATED)
        : null;
    }

    await this.updateSellVolume([sellIdBefore, entity.sell?.id]);
    await this.updateRefVolume([usedRefBefore, entity.usedRef]);

    return entity;
  }

  async updateVolumes(): Promise<void> {
    const sellIds = await this.sellRepo.find().then((l) => l.map((b) => b.id));
    await this.updateSellVolume(sellIds);
  }

  async updateRefVolumes(): Promise<void> {
    const refs = await this.buyFiatRepo
      .createQueryBuilder('buyFiat')
      .select('usedRef')
      .groupBy('usedRef')
      .getRawMany<{ usedRef: string }>();
    await this.updateRefVolume(refs.map((r) => r.usedRef));
  }

  async getUserTransactions(
    userId: number,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyFiat[]> {
    return await this.buyFiatRepo.find({
      where: { sell: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo) },
      relations: ['cryptoInput', 'bankTx', 'sell', 'sell.user', 'fiatOutput'],
    });
  }

  async getAllUserTransactions(userIds: number[]): Promise<BuyFiat[]> {
    return await this.buyFiatRepo.find({
      where: { sell: { user: { id: In(userIds) } } },
      relations: ['cryptoInput', 'bankTx', 'sell', 'sell.user'],
    });
  }

  async getSellHistory(userId: number, sellId?: number): Promise<SellHistoryDto[]> {
    const where = { user: { id: userId }, id: sellId };
    Util.removeNullFields(where);
    return this.buyFiatRepo
      .find({
        where: { sell: where },
        relations: ['sell', 'sell.user', 'cryptoInput', 'fiatOutput'],
      })
      .then((buyFiats) => buyFiats.map(this.toHistoryDto));
  }

  // --- HELPER METHODS --- //
  private toHistoryDto(buyFiat: BuyFiat): SellHistoryDto {
    return {
      inputAmount: buyFiat.inputAmount,
      inputAsset: buyFiat.inputAsset,
      outputAmount: buyFiat.outputAmount,
      outputAsset: buyFiat.outputAsset,
      // txId: buyFiat.cryptoInput.inTxId,
      txId: buyFiat.cryptoInput.inTxId,
      txUrl: `${BlockchainExplorerUrls[buyFiat.cryptoInput.asset.blockchain]}/${buyFiat.cryptoInput.inTxId}`,
      date: buyFiat.fiatOutput?.outputDate,
      amlCheck: buyFiat.amlCheck,
      isComplete: buyFiat.isComplete,
    };
  }

  private async getSell(sellId: number): Promise<Sell> {
    // sell
    const sell = await this.sellRepo.findOne({ where: { id: sellId }, relations: ['user', 'user.wallet'] });
    if (!sell) throw new BadRequestException('Sell route not found');

    return sell;
  }

  private async updateSellVolume(sellIds: number[]): Promise<void> {
    sellIds = sellIds.filter((u, j) => sellIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of sellIds) {
      const { volume } = await this.buyFiatRepo
        .createQueryBuilder('buyFiat')
        .select('SUM(amountInEur)', 'volume')
        .where('sellId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.buyFiatRepo
        .createQueryBuilder('buyFiat')
        .select('SUM(amountInEur)', 'annualVolume')
        .leftJoin('buyFiat.cryptoInput', 'cryptoInput')
        .where('buyFiat.sellId = :id', { id: id })
        .andWhere('buyFiat.amlCheck = :check', { check: AmlCheck.PASS })
        .andWhere('cryptoInput.created >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.sellService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  private async updateRefVolume(refs: string[]): Promise<void> {
    refs = refs.filter((u, j) => refs.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const ref of refs) {
      const { volume: buyFiatVolume, credit: buyFiatCredit } = await this.getRefVolume(ref);
      const { volume: buyCryptoVolume, credit: buyCryptoCredit } = await this.buyCryptoService.getRefVolume(ref);

      await this.userService.updateRefVolume(ref, buyFiatVolume + buyCryptoVolume, buyFiatCredit + buyCryptoCredit);
    }
  }

  async getRefVolume(ref: string): Promise<{ volume: number; credit: number }> {
    const { volume, credit } = await this.buyFiatRepo
      .createQueryBuilder('buyFiat')
      .select('SUM(amountInEur * refFactor)', 'volume')
      .addSelect('SUM(amountInEur * refFactor * refProvision * 0.01)', 'credit')
      .where('usedRef = :ref', { ref })
      .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
      .getRawOne<{ volume: number; credit: number }>();

    return { volume: volume ?? 0, credit: credit ?? 0 };
  }

  // Statistics

  async getTransactions(dateFrom: Date = new Date(0), dateTo: Date = new Date()): Promise<TransactionDetailsDto[]> {
    const buyFiats = await this.buyFiatRepo.find({
      where: { outputDate: Between(dateFrom, dateTo), amlCheck: AmlCheck.PASS },
      relations: ['cryptoInput'],
    });

    return buyFiats.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      // cryptoAmount: v.cryptoInput?.amount,
      // cryptoCurrency: v.cryptoInput?.asset?.name,
      cryptoAmount: v.cryptoInput?.amount,
      cryptoCurrency: v.cryptoInput?.asset?.name,
    }));
  }
}
