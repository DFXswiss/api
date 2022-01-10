import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { BuyService } from 'src/user/models/buy/buy.service';
import { UserService } from 'src/user/models/user/user.service';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';
import { AmlCheck, CryptoBuy } from './crypto-buy.entity';
import { CryptoBuyRepository } from './crypto-buy.repository';
import { CreateCryptoBuyDto } from './dto/create-crypto-buy.dto';
import { UpdateCryptoBuyDto } from './dto/update-crypto-buy.dto';

@Injectable()
export class CryptoBuyService {
  constructor(
    private readonly cryptoBuyRepo: CryptoBuyRepository,
    private readonly bankTxRepo: BankTxRepository,
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
    if (!entity) throw new NotFoundException('No matching entry found');

    const buyIdBefore = entity.buy?.id;
    const usedRefBefore = entity.usedRef;

    const update = await this.createEntity(dto);

    entity = await this.cryptoBuyRepo.save({ ...entity, ...update });

    await this.updateBuyVolume([buyIdBefore, entity.buy?.id]);
    await this.updateRefVolume([usedRefBefore, entity.usedRef]);
    return entity;
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateCryptoBuyDto | UpdateCryptoBuyDto): Promise<CryptoBuy> {
    const cryptoBuy = this.cryptoBuyRepo.create(dto);

    // bank tx
    if (dto.bankTxId) {
      cryptoBuy.bankTx = await this.bankTxRepo.findOne(dto.bankTxId);
      if (!cryptoBuy.bankTx) throw new NotFoundException('No bank TX for ID found');
    }

    // buy
    if (dto.buyId) {
      cryptoBuy.buy = await this.buyService.getBuy(dto.buyId);
      if (!cryptoBuy.buy) throw new NotFoundException('No buy for ID found');
    }

    // fiat
    if (dto.currency) {
      cryptoBuy.fiat = await this.fiatService.getFiat(dto.currency);
      if (!cryptoBuy.fiat) throw new NotFoundException('No fiat for ID found');
    }

    return cryptoBuy;
  }

  private async updateBuyVolume(buyIds: number[]): Promise<void> {
    buyIds = buyIds.filter((u, j) => buyIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of buyIds) {
      const { volume } = await this.cryptoBuyRepo
        .createQueryBuilder('cryptoBuy')
        .select('SUM(amount)', 'volume')
        .where('buyId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number }>();

      await this.buyService.updateVolume(id, volume ?? 0);
    }
  }

  private async updateRefVolume(refs: string[]): Promise<void> {
    refs = refs.filter((u, j) => refs.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const ref of refs) {
      const { volume, credit } = await this.cryptoBuyRepo
        .createQueryBuilder('cryptoBuy')
        .select('SUM(amount * refFactor)', 'volume')
        .addSelect('SUM(amount * refFactor * refProvision)', 'credit')
        .where('usedRef = :ref', { ref })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number; credit: number }>();

      await this.userService.updateRefVolume(ref, volume ?? 0, credit ?? 0);
    }
  }
}
