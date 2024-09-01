import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { BuyFiatExtended } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { BankDataType } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionTypeInternal } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { Between, In } from 'typeorm';
import { FiatOutputService } from '../../../../supporting/fiat-output/fiat-output.service';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyCryptoService } from '../../../buy-crypto/process/services/buy-crypto.service';
import { PaymentStatus } from '../../../history/dto/history.dto';
import { TransactionDetailsDto } from '../../../statistic/dto/statistic.dto';
import { SellHistoryDto } from '../../route/dto/sell-history.dto';
import { Sell } from '../../route/sell.entity';
import { SellRepository } from '../../route/sell.repository';
import { SellService } from '../../route/sell.service';
import { BuyFiat, BuyFiatEditableAmlCheck } from '../buy-fiat.entity';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { RefundInternalDto } from '../dto/refund-crypto-input.dto';
import { UpdateBuyFiatDto } from '../dto/update-buy-fiat.dto';

@Injectable()
export class BuyFiatService {
  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    private readonly userService: UserService,
    private readonly sellRepo: SellRepository,
    @Inject(forwardRef(() => SellService))
    private readonly sellService: SellService,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly fiatOutputService: FiatOutputService,
    private readonly webhookService: WebhookService,
    private readonly fiatService: FiatService,
    private readonly transactionRequestService: TransactionRequestService,
    private readonly bankDataService: BankDataService,
    private readonly transactionService: TransactionService,
    @Inject(forwardRef(() => PayInService))
    private readonly payInService: PayInService,
    private readonly userDataService: UserDataService,
  ) {}

  async createFromCryptoInput(cryptoInput: CryptoInput, sell: Sell, request?: TransactionRequest): Promise<BuyFiat> {
    let entity = this.buyFiatRepo.create({
      cryptoInput,
      sell,
      inputAmount: cryptoInput.amount,
      inputAsset: cryptoInput.asset.name,
      inputReferenceAmount: cryptoInput.amount,
      inputReferenceAsset: cryptoInput.asset.name,
      transaction: { id: cryptoInput.transaction.id },
    });

    // transaction
    request = await this.getAndCompleteTxRequest(entity, request);
    entity.transaction = await this.transactionService.update(entity.transaction.id, {
      type: TransactionTypeInternal.BUY_FIAT,
      user: sell.user,
      request,
    });

    if (!DisabledProcess(Process.AUTO_CREATE_BANK_DATA)) {
      const bankData = await this.bankDataService.getVerifiedBankDataWithIban(sell.iban, sell.userData.id);
      if (!bankData)
        await this.bankDataService.createBankData(sell.userData, {
          name: sell.userData.completeName,
          iban: sell.iban,
          type: BankDataType.BANK_OUT,
        });
    }

    entity = await this.buyFiatRepo.save(entity);

    await this.triggerWebhook(entity);

    return entity;
  }

  private async getAndCompleteTxRequest(entity: BuyFiat, request?: TransactionRequest): Promise<TransactionRequest> {
    if (request) {
      await this.transactionRequestService.complete(request.id);
    } else {
      request = await this.transactionRequestService.findAndComplete(
        entity.inputAmount,
        entity.sell.id,
        entity.cryptoInput.asset.id,
        entity.sell.fiat.id,
      );
    }

    return request;
  }

  async update(id: number, dto: UpdateBuyFiatDto): Promise<BuyFiat> {
    let entity = await this.buyFiatRepo.findOne({
      where: { id },
      relations: {
        sell: true,
        fiatOutput: true,
        bankTx: true,
        cryptoInput: true,
        transaction: { user: { userData: true, wallet: true } },
        bankData: true,
      },
    });
    if (!entity) throw new NotFoundException('Buy-fiat not found');

    const sellIdBefore = entity.sell?.id;
    const usedRefBefore = entity.usedRef;

    const update = this.buyFiatRepo.create(dto);

    // buy
    if (dto.sellId) update.sell = await this.getSell(dto.sellId);

    // bank tx
    if (dto.bankTxId) {
      update.bankTx = await this.bankTxService.getBankTxRepo().findOneBy({ id: dto.bankTxId });
      if (!update.bankTx) throw new BadRequestException('Bank TX not found');
      await this.bankTxService.getBankTxRepo().setNewUpdateTime(dto.bankTxId);
    }

    if (dto.outputReferenceAssetId) {
      update.outputReferenceAsset = await this.fiatService.getFiat(dto.outputReferenceAssetId);
      if (!update.outputReferenceAsset) throw new BadRequestException('OutputReferenceAsset not found');
    }

    if (dto.outputAssetId) {
      update.outputAsset = await this.fiatService.getFiat(dto.outputAssetId);
      if (!update.outputAsset) throw new BadRequestException('OutputAsset not found');
    }

    if (dto.bankDataId && !entity.bankData) {
      update.bankData = await this.bankDataService.getBankData(dto.bankDataId);
      if (!update.bankData) throw new NotFoundException('BankData not found');
    }

    if (dto.bankDataActive != null && (update.bankData || entity.bankData))
      await this.bankDataService.updateBankData(update.bankData?.id ?? entity.bankData.id, {
        active: dto.bankDataActive,
      });

    Util.removeNullFields(entity);

    const forceUpdate: Partial<BuyFiat> = {
      ...((BuyFiatEditableAmlCheck.includes(entity.amlCheck) ||
        (entity.amlCheck === CheckStatus.FAIL && dto.amlCheck === CheckStatus.GSHEET)) &&
      !entity.isComplete &&
      (update?.amlCheck !== entity.amlCheck || update.amlReason !== entity.amlReason)
        ? { amlCheck: update.amlCheck, mailSendDate: null, amlReason: update.amlReason }
        : undefined),
      isComplete: dto.isComplete,
      comment: update.comment,
    };
    entity = await this.buyFiatRepo.save(Object.assign(new BuyFiat(), { ...update, ...entity, ...forceUpdate }));

    if (dto.amlCheck) await this.payInService.updatePayInAction(entity.cryptoInput.id, entity.amlCheck);
    if (dto.amlReason === AmlReason.VIDEO_IDENT_NEEDED) await this.userDataService.triggerVideoIdent(entity.userData);

    // activate user
    if (entity.amlCheck === CheckStatus.PASS && entity.user) {
      await this.userService.activateUser(entity.user);
    }

    // payment webhook
    if (
      dto.isComplete ||
      (dto.amlCheck && dto.amlCheck !== CheckStatus.PASS) ||
      dto.outputReferenceAssetId ||
      dto.chargebackDate
    )
      await this.triggerWebhook(entity);

    if (dto.amountInChf) await this.updateSellVolume([sellIdBefore, entity.sell?.id]);
    if (dto.usedRef || dto.amountInEur) await this.updateRefVolume([usedRefBefore, entity.usedRef]);

    return entity;
  }

  async getBuyFiatByKey(key: string, value: any): Promise<BuyFiat> {
    return this.buyFiatRepo
      .createQueryBuilder('buyFiat')
      .select('buyFiat')
      .leftJoinAndSelect('buyFiat.sell', 'sell')
      .leftJoinAndSelect('buyFiat.transaction', 'transaction')
      .leftJoinAndSelect('transaction.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `buyFiat.${key}`} = :param`, { param: value })
      .getOne();
  }

  async triggerWebhookManual(id: number): Promise<void> {
    const buyFiat = await this.buyFiatRepo.findOne({
      where: { id },
      relations: {
        sell: true,
        bankTx: true,
        cryptoInput: true,
        transaction: { user: { wallet: true, userData: true } },
      },
    });
    if (!buyFiat) throw new NotFoundException('BuyFiat not found');

    await this.triggerWebhook(buyFiat);
  }

  async triggerWebhook(buyFiat: BuyFiat): Promise<void> {
    const extended = await this.extendBuyFiat(buyFiat);

    // TODO add fiatFiatUpdate here
    buyFiat.sell ? await this.webhookService.cryptoFiatUpdate(buyFiat.user, extended) : undefined;
  }

  async refundBuyFiat(buyFiatId: number, dto: RefundInternalDto): Promise<void> {
    const buyFiat = await this.buyFiatRepo.findOne({
      where: { id: buyFiatId },
      relations: {
        cryptoInput: { route: { user: true }, transaction: true },
        transaction: { user: { userData: true } },
      },
    });
    if (!buyFiat) throw new NotFoundException('BuyFiat not found');

    await this.refundBuyFiatInternal(buyFiat, buyFiat.chargebackAddress, dto.refundUser?.id, dto.chargebackAmount);
  }

  async refundBuyFiatInternal(
    buyFiat: BuyFiat,
    refundUserAddress: string,
    refundUserId?: number,
    chargebackAmount?: number,
  ): Promise<void> {
    if (!refundUserAddress && !refundUserId) throw new BadRequestException('You have to define a chargebackAddress');

    const refundUser = refundUserId
      ? await this.userService.getUser(refundUserId, { userData: true, wallet: true })
      : await this.userService.getUserByAddress(refundUserAddress, { userData: true, wallet: true });

    TransactionUtilService.validateRefund(buyFiat, { refundUser, chargebackAmount });

    if (chargebackAmount)
      await this.payInService.returnPayIn(
        buyFiat.cryptoInput,
        refundUser.address ?? buyFiat.chargebackAddress,
        chargebackAmount,
      );

    await this.buyFiatRepo.update(buyFiat.id, {
      chargebackDate: chargebackAmount ? new Date() : null,
      chargebackAddress: refundUser.address ?? buyFiat.chargebackAddress,
    });
  }

  async extendBuyFiat(buyFiat: BuyFiat): Promise<BuyFiatExtended> {
    const inputAssetEntity = buyFiat.cryptoInput.asset;

    return Object.assign(buyFiat, { inputAssetEntity });
  }

  async resetAmlCheck(id: number): Promise<void> {
    const entity = await this.buyFiatRepo.findOne({ where: { id }, relations: { fiatOutput: true } });
    if (!entity) throw new NotFoundException('BuyFiat not found');
    if (entity.isComplete || entity.fiatOutput?.isComplete)
      throw new BadRequestException('BuyFiat is already complete');
    if (!entity.amlCheck) throw new BadRequestException('BuyFiat amlcheck is not set');

    const fiatOutputId = entity.fiatOutput?.id;

    await this.buyFiatRepo.update(...entity.resetAmlCheck());
    if (fiatOutputId) await this.fiatOutputService.delete(fiatOutputId);
  }

  async updateVolumes(start = 1, end = 100000): Promise<void> {
    const sellIds = await this.buyFiatRepo
      .find({
        where: { id: Between(start, end) },
        relations: { sell: true },
      })
      .then((l) => l.map((b) => b.sell.id));

    await this.updateSellVolume([...new Set(sellIds)]);
  }

  async updateRefVolumes(start = 1, end = 100000): Promise<void> {
    const refs = await this.buyFiatRepo
      .createQueryBuilder('buyFiat')
      .select('usedRef')
      .groupBy('usedRef')
      .where('buyFiat.id BETWEEN :start AND :end', { start, end })
      .getRawMany<{ usedRef: string }>()
      .then((refs) => refs.map((r) => r.usedRef));

    await this.updateRefVolume([...new Set(refs)]);
  }

  async getUserVolume(userIds: number[], dateFrom: Date = new Date(0), dateTo: Date = new Date()): Promise<number> {
    return this.buyFiatRepo
      .createQueryBuilder('buyFiat')
      .select('SUM(amountInChf)', 'volume')
      .leftJoin('buyFiat.cryptoInput', 'cryptoInput')
      .leftJoin('buyFiat.sell', 'sell')
      .where('sell.userId IN (:...userIds)', { userIds })
      .andWhere('cryptoInput.created BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .andWhere('buyFiat.amlCheck != :amlCheck', { amlCheck: CheckStatus.FAIL })
      .getRawOne<{ volume: number }>()
      .then((result) => result.volume ?? 0);
  }

  async getAllUserTransactions(userIds: number[]): Promise<BuyFiat[]> {
    return this.buyFiatRepo.find({
      where: { sell: { user: { id: In(userIds) } } },
      relations: {
        cryptoInput: true,
        bankTx: true,
        sell: { user: true },
        fiatOutput: { bankTx: true },
        bankData: true,
      },
      order: { id: 'DESC' },
    });
  }

  async getSellHistory(userId: number, sellId?: number): Promise<SellHistoryDto[]> {
    const where = { user: { id: userId }, id: sellId };
    Util.removeNullFields(where);
    return this.buyFiatRepo
      .find({
        where: { sell: where },
        relations: ['sell', 'sell.user', 'cryptoInput', 'fiatOutput'],
      })
      .then((buyFiats) => buyFiats.map(this.toHistoryDto));
  }

  // --- HELPER METHODS --- //

  private toHistoryDto(buyFiat: BuyFiat): SellHistoryDto {
    return {
      inputAmount: buyFiat.inputAmount,
      inputAsset: buyFiat.inputAsset,
      outputAmount: buyFiat.outputAmount,
      outputAsset: buyFiat.outputAsset.name,
      txId: buyFiat.cryptoInput.inTxId,
      txUrl: txExplorerUrl(buyFiat.cryptoInput.asset.blockchain, buyFiat.cryptoInput.inTxId),
      date: buyFiat.fiatOutput?.outputDate,
      amlCheck: buyFiat.amlCheck,
      isComplete: buyFiat.isComplete,
      status: buyFiat.isComplete ? PaymentStatus.COMPLETE : PaymentStatus.PENDING,
    };
  }

  private async getSell(sellId: number): Promise<Sell> {
    // sell
    const sell = await this.sellRepo.findOne({ where: { id: sellId }, relations: ['user', 'user.wallet'] });
    if (!sell) throw new BadRequestException('Sell route not found');

    return sell;
  }

  async updateSellVolume(sellIds: number[]): Promise<void> {
    sellIds = sellIds.filter((u, j) => sellIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of sellIds) {
      const { volume } = await this.buyFiatRepo
        .createQueryBuilder('buyFiat')
        .select('SUM(amountInChf)', 'volume')
        .where('sellId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: CheckStatus.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.buyFiatRepo
        .createQueryBuilder('buyFiat')
        .select('SUM(amountInChf)', 'annualVolume')
        .leftJoin('buyFiat.cryptoInput', 'cryptoInput')
        .where('buyFiat.sellId = :id', { id: id })
        .andWhere('buyFiat.amlCheck = :check', { check: CheckStatus.PASS })
        .andWhere('cryptoInput.created >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.sellService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  async updateRefVolume(refs: string[]): Promise<void> {
    refs = refs.filter((u, j) => refs.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const ref of refs) {
      const { volume: buyFiatVolume, credit: buyFiatCredit } = await this.getRefVolume(ref);
      const { volume: buyCryptoVolume, credit: buyCryptoCredit } = await this.buyCryptoService.getRefVolume(ref);

      await this.userService.updateRefVolume(ref, buyFiatVolume + buyCryptoVolume, buyFiatCredit + buyCryptoCredit);
    }
  }

  async getRefVolume(ref: string): Promise<{ volume: number; credit: number }> {
    const { volume, credit } = await this.buyFiatRepo
      .createQueryBuilder('buyFiat')
      .select('SUM(amountInEur * refFactor)', 'volume')
      .addSelect('SUM(amountInEur * refFactor * refProvision * 0.01)', 'credit')
      .where('usedRef = :ref', { ref })
      .andWhere('amlCheck = :check', { check: CheckStatus.PASS })
      .getRawOne<{ volume: number; credit: number }>();

    return { volume: volume ?? 0, credit: credit ?? 0 };
  }

  // Statistics

  async getTransactions(dateFrom: Date = new Date(0), dateTo: Date = new Date()): Promise<TransactionDetailsDto[]> {
    const buyFiats = await this.buyFiatRepo.find({
      where: { outputDate: Between(dateFrom, dateTo), amlCheck: CheckStatus.PASS },
      relations: ['cryptoInput', 'cryptoInput.asset'],
      loadEagerRelations: false,
    });

    return buyFiats.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.cryptoInput?.amount,
      cryptoCurrency: v.cryptoInput?.asset?.name,
    }));
  }
}
