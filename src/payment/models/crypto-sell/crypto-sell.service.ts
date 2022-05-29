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
import { Between, In, IsNull, Not } from 'typeorm';
import { UserStatus } from 'src/user/models/user/user.entity';
import { UserService } from 'src/user/models/user/user.service';
import { Util } from 'src/shared/util';

@Injectable()
export class CryptoSellService {
  constructor(
    private readonly cryptoSellRepo: CryptoSellRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly cryptoInputRepo: CryptoInputRepository,
    private readonly sellService: SellService,
    private readonly sellRepo: SellRepository,
    private readonly userService: UserService,
  ) {}

  async create(dto: CreateCryptoSellDto): Promise<CryptoSell> {
    let entity = await this.cryptoSellRepo.findOne({ cryptoInput: { id: dto.cryptoInputId } });
    if (entity) throw new ConflictException('There is already a crypto sell for the specified crypto input');

    entity = await this.createEntity(dto);
    entity = await this.cryptoSellRepo.save(entity);

    await this.updateSellVolume([entity.cryptoInput.route.id]);

    await this.cryptoInputRepo.setNewUpdateTime(dto.cryptoInputId);
    if (dto.bankTxId) await this.bankTxRepo.setNewUpdateTime(dto.bankTxId);

    return entity;
  }

  async update(id: number, dto: UpdateCryptoSellDto): Promise<CryptoSell> {
    let entity = await this.cryptoSellRepo.findOne(id, { relations: ['cryptoInput', 'cryptoInput.route'] });
    if (!entity) throw new NotFoundException('Crypto sell not found');

    const cryptoInputWithOtherSell = dto.cryptoInputId
      ? await this.cryptoSellRepo.findOne({
          where: { id: Not(id), cryptoInput: { id: dto.cryptoInputId } },
        })
      : null;
    if (cryptoInputWithOtherSell)
      throw new ConflictException('There is already a crypto sell for the specified crypto input');

    const sellIdBefore = entity.cryptoInput.route.id;

    const update = await this.createEntity(dto);

    Util.removeNullFields(entity);

    entity = await this.cryptoSellRepo.save({ ...update, ...entity });

    await this.updateSellVolume([sellIdBefore, entity.cryptoInput.route.id]);

    if (dto.bankTxId) await this.bankTxRepo.setNewUpdateTime(dto.bankTxId);

    return entity;
  }

  async updateVolumes(): Promise<void> {
    const sellIds = await this.sellRepo.find().then((l) => l.map((b) => b.id));
    await this.updateSellVolume(sellIds);
  }

  async getUserTransactions(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<CryptoSell[]> {
    return await this.cryptoSellRepo.find({
      where: {
        cryptoInput: { route: { user: { id: In(userIds) } } },
        outputDate: Between(dateFrom, dateTo),
      },
      relations: ['cryptoInput', 'cryptoInput.route', 'cryptoInput.route.user', 'bankTx'],
    });
  }

  async getAllUserTransactions(userIds: number[]): Promise<CryptoSell[]> {
    return await this.cryptoSellRepo.find({
      where: {
        cryptoInput: { route: { user: { id: In(userIds) } } },
      },
      relations: ['cryptoInput', 'cryptoInput.route', 'cryptoInput.route.user', 'bankTx'],
    });
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateCryptoSellDto | UpdateCryptoSellDto): Promise<CryptoSell> {
    const cryptoSell = this.cryptoSellRepo.create(dto);

    // bank tx
    if (dto.bankTxId) {
      cryptoSell.bankTx = await this.bankTxRepo.findOne(dto.bankTxId);
      if (!cryptoSell.bankTx) throw new BadRequestException('Bank TX not found');
    }

    // crypto input
    if (dto.cryptoInputId) {
      cryptoSell.cryptoInput = await this.cryptoInputRepo.findOne(
        { id: dto.cryptoInputId },
        { relations: ['route', 'route.user'] },
      );
      if (!cryptoSell.cryptoInput) throw new BadRequestException('Crypto input not found');
      if (cryptoSell.cryptoInput.route.type !== RouteType.SELL)
        throw new BadRequestException('Crypto input is not a sell input');
    }

    if (cryptoSell.amlCheck === AmlCheck.PASS && cryptoSell.cryptoInput?.route?.user?.status === UserStatus.NA) {
      await this.userService.updateUserInternal(cryptoSell.cryptoInput.route.user.id, { status: UserStatus.ACTIVE });
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
        .andWhere('cryptoSell.amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.cryptoSellRepo
        .createQueryBuilder('cryptoSell')
        .select('SUM(amountInEur)', 'annualVolume')
        .innerJoin('cryptoSell.cryptoInput', 'cryptoInput')
        .where('cryptoInput.routeId = :id', { id: id })
        .andWhere('cryptoSell.amlCheck = :check', { check: AmlCheck.PASS })
        .andWhere('cryptoInput.created >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.sellService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  async getTransactions(
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ fiatAmount: number; fiatCurrency: string; date: Date; cryptoAmount: number; cryptoCurrency: string }[]> {
    const cryptoSells = await this.cryptoSellRepo.find({
      where: { outputDate: Between(dateFrom, dateTo), amlCheck: AmlCheck.PASS },
      relations: ['cryptoInput'],
    });

    return cryptoSells.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.cryptoInput?.asset?.name,
    }));
  }

  // Monitoring

  async getIncompleteTransactions(): Promise<number> {
    return await this.cryptoSellRepo.count({ mail3SendDate: IsNull() });
  }

  async getLastOutputDate(): Promise<Date> {
    return await this.cryptoSellRepo.findOne({ order: { outputDate: 'DESC' } }).then((b) => b.outputDate);
  }
}
