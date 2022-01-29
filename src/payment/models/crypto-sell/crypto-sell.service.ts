import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';
import { CryptoSellRepository } from './crypto-sell.repository';
import { CryptoSell } from './crypto-sell.entity';
import { CreateCryptoSellDto } from './dto/create-crypto-sell.dto';
import { UpdateCryptoSellDto } from './dto/update-crypto-sell.dto';
import { CryptoInputRepository } from '../crypto-input/crypto-input.repository';
import { SellService } from '../sell/sell.service';
import { SellRepository } from '../sell/sell.repository';
import { RouteType } from '../route/deposit-route.entity';
import { AmlCheck } from '../crypto-buy/crypto-buy.entity';
import { Between } from 'typeorm';

@Injectable()
export class CryptoSellService {
  constructor(
    private readonly cryptoSellRepo: CryptoSellRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly cryptoInputRepo: CryptoInputRepository,
    private readonly sellService: SellService,
    private readonly sellRepo: SellRepository,
  ) {}

  async create(dto: CreateCryptoSellDto): Promise<CryptoSell> {
    let entity = await this.cryptoSellRepo.findOne({ cryptoInput: { id: dto.cryptoInputId } });
    if (entity) throw new ConflictException('There is already a crypto sell for the specified crypto input');

    entity = await this.createEntity(dto);
    entity = await this.cryptoSellRepo.save(entity);

    await this.updateSellVolume([entity.cryptoInput.route.id]);
    return entity;
  }

  async update(id: number, dto: UpdateCryptoSellDto): Promise<CryptoSell> {
    let entity = await this.cryptoSellRepo.findOne(id, { relations: ['cryptoInput', 'cryptoInput.route'] });
    if (!entity) throw new NotFoundException('No matching entry found');

    const sellIdBefore = entity.cryptoInput.route.id;

    const update = await this.createEntity(dto);

    entity = await this.cryptoSellRepo.save({ ...entity, ...update });

    await this.updateSellVolume([sellIdBefore, entity.cryptoInput.route.id]);
    return entity;
  }

  async updateVolumes(): Promise<void> {
    const sellIds = await this.sellRepo.find().then((l) => l.map((b) => b.id));
    await this.updateSellVolume(sellIds);
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateCryptoSellDto | UpdateCryptoSellDto): Promise<CryptoSell> {
    const cryptoSell = this.cryptoSellRepo.create(dto);

    // bank tx
    if (dto.bankTxId) {
      cryptoSell.bankTx = await this.bankTxRepo.findOne(dto.bankTxId);
      if (!cryptoSell.bankTx) throw new NotFoundException('No bank TX for ID found');
    }

    // crypto input
    if (dto.cryptoInputId) {
      cryptoSell.cryptoInput = await this.cryptoInputRepo.findOne({ id: dto.cryptoInputId }, { relations: ['route'] });
      if (!cryptoSell.cryptoInput) throw new NotFoundException('No crypto input for ID found');
      if (cryptoSell.cryptoInput.route.type !== RouteType.SELL)
        throw new BadRequestException('Crypto input is not a sell input');
    }

    return cryptoSell;
  }

  private async updateSellVolume(sellIds: number[]): Promise<void> {
    sellIds = sellIds.filter((u, j) => sellIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of sellIds) {
      const { volume } = await this.cryptoSellRepo
        .createQueryBuilder('cryptoSell')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('cryptoSell.cryptoInput', 'cryptoInput')
        .where('cryptoInput.routeId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number }>();

      await this.sellService.updateVolume(id, volume ?? 0);
    }
  }

  async getTransactions(
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<{ fiatAmount: number; fiatCurrency: string; date: Date; cryptoAmount: number; cryptoCurrency: string }[]> {
    if (!dateFrom) dateFrom = new Date('15 Aug 2021 00:00:00 GMT');
    if (!dateTo) dateTo = new Date();

    const cryptoSell = await this.cryptoSellRepo.find({
      where: { outputDate: Between(dateFrom, dateTo) },
      relations: ['cryptoInput'],
    });

    return cryptoSell.map((v) => ({
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.cryptoInput?.asset?.name,
    }));
  }
}
