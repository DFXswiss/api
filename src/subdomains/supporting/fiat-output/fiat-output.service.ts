import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AzureStorageService } from 'src/integration/infrastructure/azure-storage.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { IsNull, Not } from 'typeorm';
import { BankTxReturn } from '../bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTx } from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from '../bank-tx/bank-tx/services/bank-tx.service';
import { PayInStatus } from '../payin/entities/crypto-input.entity';
import { CreateFiatOutputDto } from './dto/create-fiat-output.dto';
import { UpdateFiatOutputDto } from './dto/update-fiat-output.dto';
import { Ep2ReportService } from './ep2-report.service';
import { FiatOutput } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

@Injectable()
export class FiatOutputService {
  private readonly logger = new DfxLogger(FiatOutputService);

  constructor(
    private readonly fiatOutputRepo: FiatOutputRepository,
    private readonly buyFiatRepo: BuyFiatRepository,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly ep2ReportService: Ep2ReportService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async fillFiatOutput() {
    if (DisabledProcess(Process.FIAT_OUTPUT_COMPLETE)) return;

    const entities = await this.fiatOutputRepo.find({
      where: { amount: Not(IsNull()), isComplete: false, bankTx: { id: IsNull() } },
      relations: { bankTx: true },
    });

    for (const entity of entities) {
      try {
        const bankTx = await this.getMatchingBankTx(entity);
        if (!bankTx || entity.isApprovedDate > bankTx.created) continue;

        await this.fiatOutputRepo.update(entity.id, { bankTx, outputDate: bankTx.created });
      } catch (e) {
        this.logger.error(`Error in fiatOutput complete job: ${entity.id}`, e);
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  @Lock(1800)
  async generateReports() {
    if (DisabledProcess(Process.FIAT_OUTPUT_COMPLETE)) return;

    const entities = await this.fiatOutputRepo.find({
      where: { reportCreated: false, outputDate: Not(IsNull()) },
      relations: {
        buyFiats: { transaction: { user: { userData: true } }, cryptoInput: { paymentLinkPayment: { link: true } } },
      },
    });

    for (const entity of entities) {
      try {
        const report = this.ep2ReportService.generateReport(entity);
        const container = entity.buyFiats[0].userData.paymentLinksConfigObj.ep2ReportContainer;
        const fileName = `settlement_${Util.isoDateTime(entity.created)}.ep2`;

        await new AzureStorageService(container).uploadBlob(fileName, Buffer.from(report), 'text/xml');

        await this.fiatOutputRepo.update(entity.id, { reportCreated: true });
      } catch (e) {
        this.logger.error(`Failed to generate EP2 report for fiat output ${entity.id}:`, e);
      }
    }
  }

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
    type: string,
    { buyCrypto, buyFiats, bankTxReturn }: { buyCrypto?: BuyCrypto; buyFiats?: BuyFiat[]; bankTxReturn?: BankTxReturn },
    createReport = false,
  ): Promise<FiatOutput> {
    const entity = this.fiatOutputRepo.create({ type, buyCrypto, buyFiats, bankTxReturn });
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

  private async getMatchingBankTx(entity: FiatOutput): Promise<BankTx> {
    if (!entity.remittanceInfo) return undefined;

    return this.bankTxService.getBankTxByRemittanceInfo(entity.remittanceInfo);
  }
}
