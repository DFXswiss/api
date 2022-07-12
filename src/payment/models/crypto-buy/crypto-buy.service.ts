import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { BuyService } from '../buy/buy.service';
import { UserService } from 'src/user/models/user/user.service';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';
import { CryptoBuy } from './crypto-buy.entity';
import { CryptoBuyRepository } from './crypto-buy.repository';
import { CreateCryptoBuyDto } from './dto/create-crypto-buy.dto';
import { UpdateCryptoBuyDto } from './dto/update-crypto-buy.dto';
import { Between, Not } from 'typeorm';
import { UserStatus } from 'src/user/models/user/user.entity';
import { BuyRepository } from '../buy/buy.repository';
import { Util } from 'src/shared/util';
import { AmlCheck } from './enums/aml-check.enum';

@Injectable()
export class CryptoBuyService {
  constructor(
    private readonly cryptoBuyRepo: CryptoBuyRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly buyRepo: BuyRepository,
    private readonly buyService: BuyService,
    private readonly fiatService: FiatService,
    private readonly userService: UserService,
  ) {}

  async create(dto: CreateCryptoBuyDto): Promise<CryptoBuy> {
    let entity = await this.cryptoBuyRepo.findOne({ bankTx: { id: dto.bankTxId } });
    if (entity) throw new ConflictException('There is already a crypto buy for the specified bank TX');

    entity = await this.createEntity(dto);
    entity = await this.cryptoBuyRepo.save(entity);

    await this.updateBuyVolume([entity.buy?.id]);
    await this.updateRefVolume([entity.usedRef]);

    return entity;
  }

  async update(id: number, dto: UpdateCryptoBuyDto): Promise<CryptoBuy> {
    let entity = await this.cryptoBuyRepo.findOne(id, { relations: ['buy'] });
    if (!entity) throw new NotFoundException('Crypto buy not found');

    const bankTxWithOtherBuy = dto.bankTxId
      ? await this.cryptoBuyRepo.findOne({ id: Not(id), bankTx: { id: dto.bankTxId } })
      : null;
    if (bankTxWithOtherBuy) throw new ConflictException('There is already a crypto buy for the specified bank Tx');

    //const buyIdBefore = entity.buy?.id;
    //const usedRefBefore = entity.usedRef;

    const update = await this.createEntity(dto);

    Util.removeNullFields(entity);

    entity = await this.cryptoBuyRepo.save({ ...update, ...entity });

    //await this.updateBuyVolume([buyIdBefore, entity.buy?.id]);
    //await this.updateRefVolume([usedRefBefore, entity.usedRef]);
    return entity;
  }

  async updateVolumes(): Promise<void> {
    //const buyIds = await this.buyRepo.find().then((l) => l.map((b) => b.id));
    //await this.updateBuyVolume(buyIds);
  }

  async updateRefVolumes(): Promise<void> {
    //const refs = await this.cryptoBuyRepo
    //  .createQueryBuilder('cryptoBuy')
    //  .select('usedRef')
    //  .groupBy('usedRef')
    //  .getRawMany<{ usedRef: string }>();
    //await this.updateRefVolume(refs.map((r) => r.usedRef));
  }

  async getUserTransactions(
    userId: number,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<CryptoBuy[]> {
    return await this.cryptoBuyRepo.find({
      where: { buy: { user: { id: userId } }, amlCheck: AmlCheck.PASS, outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateCryptoBuyDto | UpdateCryptoBuyDto): Promise<CryptoBuy> {
    const cryptoBuy = this.cryptoBuyRepo.create(dto);

    // bank tx
    if (dto.bankTxId) {
      cryptoBuy.bankTx = await this.bankTxRepo.findOne(dto.bankTxId);
      if (!cryptoBuy.bankTx) throw new BadRequestException('Bank TX not found');
    }

    // buy
    if (dto.buyId) {
      cryptoBuy.buy = await this.buyRepo.findOne({ where: { id: dto.buyId }, relations: ['user'] });
      if (!cryptoBuy.buy) throw new BadRequestException('Buy route not found');
    }

    // fiat
    if (dto.currency) {
      cryptoBuy.fiat = await this.fiatService.getFiatByName(dto.currency);
      if (!cryptoBuy.fiat) throw new BadRequestException('Fiat not found');
    }

    if (cryptoBuy.amlCheck === AmlCheck.PASS && cryptoBuy.buy?.user?.status === UserStatus.NA) {
      await this.userService.updateUserInternal(cryptoBuy.buy.user.id, { status: UserStatus.ACTIVE });
    }

    return cryptoBuy;
  }

  private async updateBuyVolume(buyIds: number[]): Promise<void> {
    buyIds = buyIds.filter((u, j) => buyIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of buyIds) {
      const { volume } = await this.cryptoBuyRepo
        .createQueryBuilder('cryptoBuy')
        .select('SUM(amountInEur)', 'volume')
        .where('buyId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.cryptoBuyRepo
        .createQueryBuilder('cryptoBuy')
        .select('SUM(amountInEur)', 'annualVolume')
        .where('buyId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .andWhere('inputDate >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.buyService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  private async updateRefVolume(refs: string[]): Promise<void> {
    refs = refs.filter((u, j) => refs.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const ref of refs) {
      const { volume, credit } = await this.cryptoBuyRepo
        .createQueryBuilder('cryptoBuy')
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
    const cryptoBuys = await this.cryptoBuyRepo.find({
      where: { outputDate: Between(dateFrom, dateTo), amlCheck: AmlCheck.PASS },
      relations: ['buy'],
    });

    return cryptoBuys.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.buy?.asset?.name,
    }));
  }
}
