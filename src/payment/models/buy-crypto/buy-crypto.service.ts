import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BuyService } from '../buy/buy.service';
import { UserService } from 'src/user/models/user/user.service';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';
import { Between, In, IsNull } from 'typeorm';
import { UserStatus } from 'src/user/models/user/user.entity';
import { BuyRepository } from '../buy/buy.repository';
import { Util } from 'src/shared/util';
import { AmlCheck, BuyCrypto } from './buy-crypto.entity';
import { BuyCryptoRepository } from './buy-crypto.repository';
import { UpdateBuyCryptoDto } from './dto/update-buy-crypto.dto';
import { Buy } from '../buy/buy.entity';

@Injectable()
export class BuyCryptoService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly buyRepo: BuyRepository,
    private readonly buyService: BuyService,
    private readonly userService: UserService,
  ) {}

  async create(bankTxId: number, buyId: number): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne({ bankTx: { id: bankTxId } });
    if (entity) throw new ConflictException('There is already a buy crypto for the specified bank TX');

    entity = this.buyCryptoRepo.create();

    // bank tx
    entity.bankTx = await this.bankTxRepo.findOne(bankTxId);
    if (!entity.bankTx) throw new BadRequestException('Bank TX not found');

    // buy
    if (buyId) entity.buy = await this.getBuy(buyId);

    return await this.buyCryptoRepo.save(entity);
  }

  async update(id: number, dto: UpdateBuyCryptoDto): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne(id, { relations: ['buy'] });
    if (!entity) throw new NotFoundException('Buy crypto not found');

    // const buyIdBefore = entity.buy?.id;
    // const usedRefBefore = entity.usedRef;

    const update = this.buyCryptoRepo.create(dto);

    // buy
    if (dto.buyId) update.buy = await this.getBuy(dto.buyId);

    Util.removeNullFields(entity);

    entity = await this.buyCryptoRepo.save({ ...update, ...entity });

    // activate user
    if (entity.amlCheck === AmlCheck.PASS && entity.buy?.user?.status === UserStatus.NA) {
      await this.userService.updateUserInternal(entity.buy.user.id, { status: UserStatus.ACTIVE });
    }

    // TODO aktivieren nach Umstellung cryptoBuy -> buyCrypto
    // await this.updateBuyVolume([buyIdBefore, entity.buy?.id]);
    // await this.updateRefVolume([usedRefBefore, entity.usedRef]);

    return entity;
  }

  async updateVolumes(): Promise<void> {
    // TODO aktivieren nach Umstellung cryptoBuy -> buyCrypto
    // const buyIds = await this.buyRepo.find().then((l) => l.map((b) => b.id));
    // await this.updateBuyVolume(buyIds);
  }

  async updateRefVolumes(): Promise<void> {
    // TODO aktivieren nach Umstellung cryptoBuy -> buyCrypto
    // const refs = await this.buyCryptoRepo
    //   .createQueryBuilder('buyCrypto')
    //   .select('usedRef')
    //   .groupBy('usedRef')
    //   .getRawMany<{ usedRef: string }>();
    // await this.updateRefVolume(refs.map((r) => r.usedRef));
  }

  async getUserTransactions(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    // TODO aktivieren in history nach Umstellung cryptoBuy -> buyCrypto
    return await this.buyCryptoRepo.find({
      where: { buy: { user: { id: In(userIds) } }, outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  async getAllUserTransactions(userIds: number[]): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { buy: { user: { id: In(userIds) } } },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  async getRefTransactions(
    refCodes: string[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes), outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  async getAllRefTransactions(refCodes: string[]): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  // --- HELPER METHODS --- //
  private async getBuy(buyId: number): Promise<Buy> {
    // buy
    const buy = await this.buyRepo.findOne({ where: { id: buyId }, relations: ['user'] });
    if (!buy) throw new BadRequestException('Buy route not found');

    return buy;
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

  private async updateRefVolume(refs: string[]): Promise<void> {
    refs = refs.filter((u, j) => refs.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const ref of refs) {
      const { volume, credit } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur * refFactor)', 'volume')
        .addSelect('SUM(amountInEur * refFactor * refProvision * 0.01)', 'credit')
        .where('usedRef = :ref', { ref })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number; credit: number }>();

      await this.userService.updateRefVolume(ref, volume ?? 0, credit ?? 0);
    }
  }

  async getTransactions(
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ fiatAmount: number; fiatCurrency: string; date: Date; cryptoAmount: number; cryptoCurrency: string }[]> {
    const buyCryptos = await this.buyCryptoRepo.find({
      where: { outputDate: Between(dateFrom, dateTo), amlCheck: AmlCheck.PASS },
      relations: ['buy'],
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

  // Monitoring

  async getIncompleteTransactions(): Promise<number> {
    return await this.buyCryptoRepo.count({ mailSendDate: IsNull() });
  }

  async getLastOutputDate(): Promise<Date> {
    return await this.buyCryptoRepo.findOne({ order: { outputDate: 'DESC' } }).then((b) => b.outputDate);
  }
}
