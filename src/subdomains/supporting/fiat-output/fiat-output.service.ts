import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { BankTxService } from '../bank-tx/bank-tx/bank-tx.service';
import { CreateFiatOutputDto } from './dto/create-fiat-output.dto';
import { UpdateFiatOutputDto } from './dto/update-fiat-output.dto';
import { FiatOutput } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

@Injectable()
export class FiatOutputService {
  constructor(
    private readonly fiatOutputRepo: FiatOutputRepository,
    private readonly buyFiatRepo: BuyFiatRepository,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly buyCryptoRepo: BuyCryptoRepository,
  ) {}

  async create(dto: CreateFiatOutputDto): Promise<FiatOutput> {
    const existing = await this.fiatOutputRepo.exists({
      where: [
        { buyCrypto: { id: dto.buyCryptoId }, type: dto.type },
        { buyFiat: { id: dto.buyFiatId }, type: dto.type },
      ],
    });
    if (existing) throw new BadRequestException('FiatOutput already exists');

    const entity = this.fiatOutputRepo.create(dto);

    if (dto.buyFiatId) {
      entity.buyFiat = await this.buyFiatRepo.findOneBy({ id: dto.buyFiatId });
      if (!entity.buyFiat) throw new NotFoundException('BuyFiat not found');
    }

    if (dto.buyCryptoId) {
      entity.buyCrypto = await this.buyCryptoRepo.findOneBy({ id: dto.buyCryptoId });
      if (!entity.buyCrypto) throw new NotFoundException('BuyCrypto not found');
    }

    return this.fiatOutputRepo.save(entity);
  }

  async update(id: number, dto: UpdateFiatOutputDto): Promise<FiatOutput> {
    const entity = await this.fiatOutputRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('FiatOutput not found');

    if (dto.bankTxId) {
      entity.bankTx = await this.bankTxService.getBankTxRepo().findOneBy({ id: dto.bankTxId });
      if (!entity.bankTx) throw new NotFoundException('BankTx not found');
    }

    return this.fiatOutputRepo.save({ ...entity, ...dto });
  }

  async delete(id: number): Promise<void> {
    const entity = await this.fiatOutputRepo.findOne({ where: { id }, relations: { buyFiat: true } });
    if (!entity) throw new NotFoundException('FiatOutput not found');
    if (entity.buyFiat) throw new BadRequestException('FiatOutput remaining buyFiat');

    await this.fiatOutputRepo.delete(id);
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
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `fiatOutput.${key}`} = :param`, { param: value })
      .getOne();
  }
}
