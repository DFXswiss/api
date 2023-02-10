import { Injectable, NotFoundException } from '@nestjs/common';
import { KeyType } from 'src/shared/utils/util';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/buy-fiat/buy-fiat.repository';
import { BankTxService } from '../bank-tx/bank-tx.service';
import { CreateFiatOutputDto } from './dto/create-fiat-output.dto';
import { UpdateFiatOutputDto } from './dto/update-fiat-output.dto';
import { FiatOutput } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

@Injectable()
export class FiatOutputService {
  constructor(
    private readonly fiatOutputRepo: FiatOutputRepository,
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly bankTxService: BankTxService,
  ) {}

  async create(dto: CreateFiatOutputDto): Promise<FiatOutput> {
    const entity = this.fiatOutputRepo.create(dto);

    if (dto.buyFiatId) {
      entity.buyFiat = await this.buyFiatRepo.findOne({ where: { id: dto.buyFiatId } });
      if (!entity.buyFiat) throw new NotFoundException('Buy fiat not found');
    }

    return await this.fiatOutputRepo.save(entity);
  }

  async update(id: number, dto: UpdateFiatOutputDto): Promise<FiatOutput> {
    const entity = await this.fiatOutputRepo.findOne(id);
    if (!entity) throw new NotFoundException('FiatOutput not found');

    if (dto.bankTxId) {
      entity.bankTx = await this.bankTxService.getBankTxRepo().findOne({ id: dto.bankTxId });
      if (!entity.bankTx) throw new NotFoundException('BankTx not found');
    }

    return await this.fiatOutputRepo.save({ ...entity, ...dto });
  }

  async getFiatOutputByKey(key: string, value: any): Promise<FiatOutput> {
    return this.fiatOutputRepo
      .createQueryBuilder('fiatOutput')
      .select('fiatOutput')
      .leftJoinAndSelect('fiatOutput.buyFiat', 'buyFiat')
      .leftJoinAndSelect('buyFiat.sell', 'sell')
      .leftJoinAndSelect('sell.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .where(`fiatOutput.${key} = :param`, { param: value })
      .getOne();
  }
}
