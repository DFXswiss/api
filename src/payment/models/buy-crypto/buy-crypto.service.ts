import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BuyService } from '../buy/buy.service';
import { UserService } from 'src/user/models/user/user.service';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';
import { Between, Not } from 'typeorm';
import { UserStatus } from 'src/user/models/user/user.entity';
import { BuyRepository } from '../buy/buy.repository';
import { Util } from 'src/shared/util';
import { AmlCheck, BuyCrypto } from './buy-crypto.entity';
import { BuyCryptoRepository } from './buy-crypto.repository';
import { CreateBuyCryptoDto } from './dto/create-buy-crypto.dto';
import { UpdateBuyCryptoDto } from './dto/update-buy-crypto.dto';

@Injectable()
export class BuyCryptoService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly buyRepo: BuyRepository,
    private readonly buyService: BuyService,
    private readonly userService: UserService,
  ) {}

  async create(dto: CreateBuyCryptoDto): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne({ bankTx: { id: dto.bankTxId } });
    if (entity) throw new ConflictException('There is already a buy crypto for the specified bank TX');

    entity = await this.createEntity(dto);
    entity = await this.buyCryptoRepo.save(entity);

    // await this.updateBuyVolume([entity.buy?.id]);
    // await this.updateRefVolume([entity.usedRef]);

    // await this.bankTxRepo.setNewUpdateTime(dto.bankTxId);

    return entity;
  }

  async update(id: number, dto: UpdateBuyCryptoDto): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne(id, { relations: ['buy'] });
    if (!entity) throw new NotFoundException('Buy crypto not found');

    const bankTxWithOtherBuy = dto.bankTxId
      ? await this.buyCryptoRepo.findOne({ id: Not(id), bankTx: { id: dto.bankTxId } })
      : null;
    if (bankTxWithOtherBuy) throw new ConflictException('There is already a buy crypto for the specified bank Tx');

    const buyIdBefore = entity.buy?.id;
    const usedRefBefore = entity.usedRef;

    const update = await this.createEntity(dto);

    Util.removeNullFields(entity);

    entity = await this.buyCryptoRepo.save({ ...update, ...entity });

    await this.updateBuyVolume([buyIdBefore, entity.buy?.id]);
    // TODO Ref auch für CryptoCrypto später?
    await this.updateRefVolume([usedRefBefore, entity.usedRef]);
    return entity;
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
    return await this.buyCryptoRepo.find({
      where: { buy: { user: { id: userId } }, amlCheck: AmlCheck.PASS, outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateBuyCryptoDto | UpdateBuyCryptoDto): Promise<BuyCrypto> {
    const buyCrypto = this.buyCryptoRepo.create(dto);

    // bank tx
    if (dto.bankTxId) {
      buyCrypto.bankTx = await this.bankTxRepo.findOne(dto.bankTxId);
      if (!buyCrypto.bankTx) throw new BadRequestException('Bank TX not found');
    }

    // crypto Input
    // if (dto.cryptoInputId) {
    //   buyCrypto.bankTx = await this.bankTxRepo.findOne(dto.bankTxId);
    //   if (!buyCrypto.bankTx) throw new BadRequestException('Bank TX not found');
    // }

    // buy
    if (dto.buyId) {
      buyCrypto.buy = await this.buyRepo.findOne({ where: { id: dto.buyId }, relations: ['user'] });
      if (!buyCrypto.buy) throw new BadRequestException('Buy route not found');
    }

    if (buyCrypto.amlCheck === AmlCheck.PASS && buyCrypto.buy?.user?.status === UserStatus.NA) {
      await this.userService.updateUserInternal(buyCrypto.buy.user.id, { status: UserStatus.ACTIVE });
    }

    return buyCrypto;
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
        // .leftJoin('buyCrypto.cryptoInput', 'cryptoInput')
        .where('buyCrypto.buyId = :id', { id: id })
        .andWhere('buyCrypto.amlCheck = :check', { check: AmlCheck.PASS })
        .andWhere('bankTx.bookingDate >= :year', { year: newYear })
        // .andWhere(
        //   new Brackets((qb) => {
        //     qb.where('bankTx.bookingDate >= :year', { year: newYear }).orWhere('cryptoInput.created >= :year', {
        //       year: newYear,
        //     });
        //   }),
        // )
        //TODO kein Input Date mehr vorhanden
        //.andWhere('inputDate >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.buyService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  private async updateRefVolume(refs: string[]): Promise<void> {
    refs = refs.filter((u, j) => refs.indexOf(u) === j).filter((i) => i); // distinct, not null

    // TODO wird es bei crypto2crypto auch ref geben?
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
}
