import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LoggerFactory } from 'src/logger/logger.factory';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { BankTxReturn } from '../bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTxService } from '../bank-tx/bank-tx/services/bank-tx.service';
import { PayInStatus } from '../payin/entities/crypto-input.entity';
import { CreateFiatOutputDto } from './dto/create-fiat-output.dto';
import { UpdateFiatOutputDto } from './dto/update-fiat-output.dto';
import { FiatOutput, FiatOutputType } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

@Injectable()
export class FiatOutputService {
  constructor(
    readonly loggerFactory: LoggerFactory,
    private readonly fiatOutputRepo: FiatOutputRepository,
    private readonly buyFiatRepo: BuyFiatRepository,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly buyCryptoRepo: BuyCryptoRepository,
  ) {}

  async create(dto: CreateFiatOutputDto): Promise<FiatOutput> {
    if (dto.buyCryptoId || dto.buyFiatId || dto.bankTxReturnId) {
      const existing = await this.fiatOutputRepo.exists({
        where: dto.buyCryptoId
          ? { buyCrypto: { id: dto.buyCryptoId }, type: dto.type }
          : dto.buyFiatId
          ? { buyFiats: { id: dto.buyFiatId }, type: dto.type }
          : { bankTxReturn: { id: dto.bankTxReturnId }, type: dto.type },
      });
      if (existing) throw new BadRequestException('FiatOutput already exists');
    }

    const entity = this.fiatOutputRepo.create(dto);

    if (dto.buyFiatId) {
      entity.buyFiats = [await this.buyFiatRepo.findOneBy({ id: dto.buyFiatId })];
      if (!entity.buyFiats[0]) throw new NotFoundException('BuyFiat not found');
      if (
        dto.type === 'BuyFiat' &&
        [PayInStatus.FORWARD_CONFIRMED, PayInStatus.COMPLETED].includes(entity.buyFiats[0].cryptoInput.status)
      )
        throw new BadRequestException('CryptoInput not confirmed');
    }

    if (dto.buyCryptoId) {
      entity.buyCrypto = await this.buyCryptoRepo.findOneBy({ id: dto.buyCryptoId });
      if (!entity.buyCrypto) throw new NotFoundException('BuyCrypto not found');
    }

    return this.fiatOutputRepo.save(entity);
  }

  async createInternal(
    type: FiatOutputType,
    { buyCrypto, buyFiats, bankTxReturn }: { buyCrypto?: BuyCrypto; buyFiats?: BuyFiat[]; bankTxReturn?: BankTxReturn },
    originEntityId: number,
    createReport = false,
  ): Promise<FiatOutput> {
    const entity = this.fiatOutputRepo.create({ type, buyCrypto, buyFiats, bankTxReturn, originEntityId });
    if (createReport) entity.reportCreated = false;

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
    const entity = await this.fiatOutputRepo.findOne({ where: { id }, relations: { buyFiats: true } });
    if (!entity) throw new NotFoundException('FiatOutput not found');
    if (entity.buyFiats?.length) throw new BadRequestException('FiatOutput remaining buyFiat');

    await this.fiatOutputRepo.delete(id);
  }

  async getFiatOutputByKey(key: string, value: any): Promise<FiatOutput> {
    return this.fiatOutputRepo
      .createQueryBuilder('fiatOutput')
      .select('fiatOutput')
      .leftJoinAndSelect('fiatOutput.buyFiats', 'buyFiats')
      .leftJoinAndSelect('buyFiats.sell', 'sell')
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
