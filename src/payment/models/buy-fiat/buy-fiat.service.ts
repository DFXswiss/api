import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BuyFiat } from './buy-fiat.entity';
import { BuyFiatRepository } from './buy-fiat.repository';
import { CryptoInput } from '../crypto-input/crypto-input.entity';
import { Sell } from '../sell/sell.entity';
import { Between, In, IsNull, Not } from 'typeorm';
import { UpdateBuyFiatDto } from './dto/update-buy-fiat.dto';
import { Util } from 'src/shared/util';
import { AmlCheck } from '../buy-crypto/enums/aml-check.enum';
import { UserStatus } from 'src/user/models/user/user.entity';
import { UserService } from 'src/user/models/user/user.service';
import { SellRepository } from '../sell/sell.repository';
import { SellService } from '../sell/sell.service';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';

@Injectable()
export class BuyFiatService {
  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly userService: UserService,
    private readonly sellRepo: SellRepository,
    private readonly sellService: SellService,
    private readonly bankTxRepo: BankTxRepository,
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
      update.bankTx = await this.bankTxRepo.findOne({ id: dto.bankTxId });
      if (!update.bankTx) throw new BadRequestException('Bank TX not found');
    }

    Util.removeNullFields(entity);

    //TODO update aller Felder wieder deaktivieren
    entity = await this.buyFiatRepo.save({ ...entity, ...update });

    // activate user
    if (entity.amlCheck === AmlCheck.PASS) {
      await this.userService.activateUser(entity.sell?.user);
    }

    //TODO cryptoSell -> buyFiat Umstellung
    //await this.updateSellVolume([sellIdBefore, entity.sell?.id]);

    return entity;
  }

  async updateVolumes(): Promise<void> {
    //const sellIds = await this.sellRepo.find().then((l) => l.map((b) => b.id));
    //await this.updateSellVolume(sellIds);
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

  // --- HELPER METHODS --- //
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
      fiatAmount: v.outputAmount,
      fiatCurrency: v.outputAsset,
      date: v.outputDate,
      cryptoAmount: v.cryptoInput?.amount,
      cryptoCurrency: v.cryptoInput?.asset?.name,
    }));
  }
}
