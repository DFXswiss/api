import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BuyFiat } from './buy-fiat.entity';
import { BuyFiatRepository } from './buy-fiat.repository';
import { CryptoInput } from '../../../../mix/models/crypto-input/crypto-input.entity';
import { Sell } from '../sell/sell.entity';
import { Between, In } from 'typeorm';
import { UpdateBuyFiatDto } from './dto/update-buy-fiat.dto';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { SellRepository } from '../sell/sell.repository';
import { SellService } from '../sell/sell.service';
import { SellHistoryDto } from '../sell/dto/sell-history.dto';
import { AmlCheck } from '../../buy-crypto/process/enums/aml-check.enum';
import { BankTxService } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.service';

@Injectable()
export class BuyFiatService {
  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly userService: UserService,
    private readonly sellRepo: SellRepository,
    private readonly sellService: SellService,
    private readonly bankTxService: BankTxService,
  ) {}

  async create(cryptoInput: CryptoInput): Promise<BuyFiat> {
    const entity = this.buyFiatRepo.create();

    entity.cryptoInput = cryptoInput;
    entity.sell = cryptoInput.route as Sell;

    return await this.buyFiatRepo.save(entity);
  }

  async update(id: number, dto: UpdateBuyFiatDto): Promise<BuyFiat> {
    let entity = await this.buyFiatRepo.findOne(id, { relations: ['sell', 'sell.user'] });
    if (!entity) throw new NotFoundException('Buy fiat not found');

    const sellIdBefore = entity.sell?.id;

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

    await this.updateSellVolume([sellIdBefore, entity.sell?.id]);

    return entity;
  }

  async updateVolumes(): Promise<void> {
    const sellIds = await this.sellRepo.find().then((l) => l.map((b) => b.id));
    await this.updateSellVolume(sellIds);
  }

  async getUserTransactions(
    userId: number,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyFiat[]> {
    return await this.buyFiatRepo.find({
      where: { sell: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo) },
      relations: ['cryptoInput', 'bankTx', 'sell', 'sell.user'],
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
        relations: ['sell', 'sell.user', 'cryptoInput'],
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
      txId: buyFiat.cryptoInput.inTxId,
      date: buyFiat.outputDate,
      amlCheck: buyFiat.amlCheck,
      isComplete: buyFiat.isComplete,
    };
  }

  private async getSell(sellId: number): Promise<Sell> {
    // sell
    const sell = await this.sellRepo.findOne({ where: { id: sellId }, relations: ['user'] });
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

  // Statistics

  async getTransactions(
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ fiatAmount: number; fiatCurrency: string; date: Date; cryptoAmount: number; cryptoCurrency: string }[]> {
    const buyFiats = await this.buyFiatRepo.find({
      where: { outputDate: Between(dateFrom, dateTo), amlCheck: AmlCheck.PASS },
      relations: ['cryptoInput'],
    });

    return buyFiats.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.cryptoInput?.amount,
      cryptoCurrency: v.cryptoInput?.asset?.name,
    }));
  }
}
