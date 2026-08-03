import { ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { BuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { SwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/swap-payment-info.dto';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { TransactionRequestExtended } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { SellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/sell-payment-info.dto';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { Between, FindOptionsRelations, In, IsNull, LessThan, MoreThan, Not } from 'typeorm';
import { CustodyOrder } from '../../../core/custody/entities/custody-order.entity';
import { CustodyOrderStatus } from '../../../core/custody/enums/custody';
import { Deposit } from '../../address-pool/deposit/deposit.entity';
import { DepositRoute } from '../../address-pool/route/deposit-route.entity';
import { CryptoPaymentMethod, FiatPaymentMethod } from '../dto/payment-method.enum';
import {
  TransactionRequest,
  TransactionRequestStatus,
  TransactionRequestType,
} from '../entities/transaction-request.entity';
import { TransactionRequestRepository } from '../repositories/transaction-request.repository';

@Injectable()
export class TransactionRequestService {
  private readonly logger = new DfxLogger(TransactionRequestService);

  constructor(
    private readonly transactionRequestRepo: TransactionRequestRepository,
    private readonly siftService: SiftService,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    @Inject(forwardRef(() => BuyService))
    private readonly buyService: BuyService,
    @Inject(forwardRef(() => SellService))
    private readonly sellService: SellService,
    @Inject(forwardRef(() => SwapService))
    private readonly swapService: SwapService,
  ) {}

  // useDelay: false keeps the schedule this job had as a native @Cron. DfxCron staggers job
  // starts by default, which for a minute-based expression spreads them over up to 30 seconds -
  // moving it here would change when it runs, not just how it is registered.
  @DfxCron(CronExpression.EVERY_MINUTE, {
    scope: CronScope.Worker,
    process: Process.TX_REQUEST,
    useDelay: false,
    timeout: 7200,
  })
  async txRequestStatusSync() {
    await this.syncStatus();
    await this.deleteOldTxRequests();
  }

  @DfxCron(CronExpression.EVERY_DAY_AT_3AM, {
    scope: CronScope.Worker,
    process: Process.TX_REQUEST_WAITING_EXPIRY,
    timeout: 7200,
  })
  async txRequestWaitingExpiryCheck() {
    const expiryDate = Util.daysBefore(Config.txRequestWaitingExpiryDays);
    const entities = await this.transactionRequestRepo.findBy({
      status: TransactionRequestStatus.WAITING_FOR_PAYMENT,
      created: LessThan(expiryDate),
    });

    for (const entity of entities) {
      await this.transactionRequestRepo.update(entity.id, { status: TransactionRequestStatus.CREATED });
    }
  }

  async deleteOldTxRequests(): Promise<void> {
    const entities = await this.transactionRequestRepo.find({
      where: {
        isComplete: false,
        created: LessThan(Util.daysBefore(90)),
        transaction: { id: IsNull() },
        custodyOrder: { id: IsNull() },
        supportIssues: { id: IsNull() },
      },
      relations: { transaction: true, custodyOrder: true, supportIssues: true },
      take: 5000,
    });

    for (const entity of entities) {
      await this.transactionRequestRepo.delete(entity.id);
    }
  }

  async syncStatus(): Promise<void> {
    const entities = await this.transactionRequestRepo.find({
      where: { status: IsNull() },
      take: 5000,
    });

    const expiryDate = Util.daysBefore(Config.txRequestWaitingExpiryDays);

    for (const entity of entities) {
      await this.transactionRequestRepo.update(entity.id, { status: this.currentStatus(entity, expiryDate) });
    }
  }

  async create(
    type: TransactionRequestType,
    request: GetBuyPaymentInfoDto | GetSellPaymentInfoDto | GetSwapPaymentInfoDto,
    response: BuyPaymentInfoDto | SellPaymentInfoDto | SwapPaymentInfoDto,
    userId: number,
    bankSelection?: { bankId: number; virtualIbanId?: number },
  ): Promise<TransactionRequest | undefined> {
    try {
      const uid = Util.createUid(Config.prefixes.quoteUidPrefix);

      // create the entity
      const transactionRequest = this.transactionRequestRepo.create({
        type,
        routeId: response.routeId,
        amount: response.amount,
        estimatedAmount: response.estimatedAmount,
        externalTransactionId: request.externalTransactionId,
        exchangeRate: response.exchangeRate,
        rate: response.rate,
        paymentRequest: response.paymentRequest,
        isValid: response.isValid,
        error: response.error,
        exactPrice: response.exactPrice,
        dfxFee: response.fees.dfx,
        networkFee: response.fees.network,
        totalFee: response.fees.total,
        fees: response.fees,
        priceSteps: response.priceSteps,
        user: { id: userId },
        uid,
      });

      let sourceCurrencyName: string;
      let targetCurrencyName: string;
      let blockchain: Blockchain;
      let siftOrder: boolean;

      switch (type) {
        case TransactionRequestType.BUY: {
          const buyRequest = request as GetBuyPaymentInfoDto;
          const buyResponse = response as BuyPaymentInfoDto;

          transactionRequest.sourcePaymentMethod = buyRequest.paymentMethod;
          transactionRequest.targetPaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.sourceId = buyResponse.currency.id;
          transactionRequest.targetId = buyResponse.asset.id;
          transactionRequest.paymentLink = buyResponse.paymentLink;
          transactionRequest.bankId = bankSelection?.bankId;
          transactionRequest.virtualIbanId = bankSelection?.virtualIbanId;
          sourceCurrencyName = buyResponse.currency.name;
          targetCurrencyName = buyResponse.asset.name;
          blockchain = buyResponse.asset.blockchain;
          siftOrder = true;
          break;
        }

        case TransactionRequestType.SELL: {
          const sellResponse = response as SellPaymentInfoDto;

          transactionRequest.sourcePaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.targetPaymentMethod = FiatPaymentMethod.BANK;
          transactionRequest.sourceId = sellResponse.asset.id;
          transactionRequest.targetId = sellResponse.currency.id;
          sourceCurrencyName = sellResponse.asset.name;
          targetCurrencyName = sellResponse.currency.name;
          blockchain = sellResponse.asset.blockchain;
          break;
        }

        case TransactionRequestType.SWAP: {
          const convertResponse = response as SwapPaymentInfoDto;

          transactionRequest.sourcePaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.targetPaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.sourceId = convertResponse.sourceAsset.id;
          transactionRequest.targetId = convertResponse.targetAsset.id;
          sourceCurrencyName = convertResponse.sourceAsset.name;
          targetCurrencyName = convertResponse.targetAsset.name;
          break;
        }
      }

      // save
      await this.transactionRequestRepo.save(transactionRequest);
      response.id = transactionRequest.id;
      response.uid = uid;
      response.statusUrl = `${Config.frontend.services}/tx/${uid}`;
      response.expiryDate = Util.minutesAfter(Config.txRequestValidityMinutes);

      // create order at sift (without waiting)
      if (siftOrder)
        void this.siftService.createOrder(
          transactionRequest,
          userId,
          sourceCurrencyName,
          targetCurrencyName,
          blockchain,
        );

      return transactionRequest;
    } catch (e) {
      this.logger.error(
        `Failed to store ${type} transaction request ` + `(routeId=${response.routeId}, userId=${userId}):`,
        e,
      );
      throw e;
    }
  }

  async getOrThrow(id: number, userId: number): Promise<TransactionRequest | undefined> {
    const request = await this.transactionRequestRepo.findOne({
      where: { id },
      relations: { user: { userData: { organization: true } }, custodyOrder: true },
    });

    if (!request) throw new NotFoundException('Transaction request not found');
    if (request.user.id !== userId) throw new ForbiddenException('Not your transaction request');

    return request;
  }

  async getTransactionRequest(
    id: number,
    relations: FindOptionsRelations<TransactionRequest> = {},
  ): Promise<TransactionRequest | undefined> {
    return this.transactionRequestRepo.findOne({
      where: { id },
      relations,
    });
  }

  async getWaitingTransactionRequest(
    userDataId: number,
    from = new Date(0),
    to = new Date(),
  ): Promise<TransactionRequest[]> {
    return this.transactionRequestRepo.find({
      where: {
        status: TransactionRequestStatus.WAITING_FOR_PAYMENT,
        user: { userData: { id: userDataId } },
        created: Between(from, to),
      },
    });
  }

  async getTransactionRequestByUid(
    uid: string,
    relations: FindOptionsRelations<TransactionRequest> = {},
  ): Promise<TransactionRequest | undefined> {
    return this.transactionRequestRepo.findOne({ where: { uid }, relations });
  }

  async getOpenBuyQuotes(assetId: number): Promise<TransactionRequest[]> {
    return this.transactionRequestRepo.find({
      where: {
        type: TransactionRequestType.BUY,
        targetId: assetId,
        status: TransactionRequestStatus.WAITING_FOR_PAYMENT,
      },
      relations: { user: true },
      order: { created: 'ASC' },
    });
  }

  async findAndComplete(
    amount: number,
    routeId: number,
    sourceId: number,
    targetId: number,
  ): Promise<TransactionRequest> {
    const matchingRequests = await this.transactionRequestRepo.find({
      where: {
        routeId,
        sourceId,
        targetId,
        isComplete: false,
        created: MoreThan(Util.daysBefore(Config.txRequestWaitingExpiryDays)),
        status: In([TransactionRequestStatus.CREATED, TransactionRequestStatus.WAITING_FOR_PAYMENT]),
        amount: Between(amount * 0.99, amount * 1.01),
      },
      order: { created: 'DESC' },
      relations: { user: true, custodyOrder: { user: true } },
    });

    const pendingRequests = matchingRequests.filter((t) => t.status === TransactionRequestStatus.WAITING_FOR_PAYMENT);

    const matchingRequest =
      pendingRequests.find((t) => t.amount === amount) ??
      pendingRequests.at(0) ??
      matchingRequests.find((t) => t.amount === amount) ??
      matchingRequests.at(0);

    if (pendingRequests.length > 1) {
      for (const pendingRequest of pendingRequests.filter((t) => t.id !== matchingRequest.id)) {
        await this.transactionRequestRepo.update(...pendingRequest.resetStatus());
      }
    }

    if (matchingRequest) await this.complete(matchingRequest.id);

    return matchingRequest;
  }

  async complete(id: number): Promise<void> {
    await this.transactionRequestRepo.update(id, {
      isComplete: true,
      status: TransactionRequestStatus.COMPLETED,
    });
  }

  // Atomically claims the request for this settlement. A second job instance that already completed
  // it - or assigned a different event to it - leaves affected = 0, and the caller must then not
  // treat the event as consumed. A plain update would let two instances overwrite one another and
  // release the first event back into the pool
  async completeSettlement(id: number, settlement: { txId: string; eventId: string }): Promise<boolean> {
    const result = await this.transactionRequestRepo.update(
      { id, status: TransactionRequestStatus.WAITING_FOR_PAYMENT, settlementEventId: IsNull() },
      {
        isComplete: true,
        status: TransactionRequestStatus.COMPLETED,
        settlementTxId: settlement.txId,
        settlementEventId: settlement.eventId,
      },
    );

    return Boolean(result.affected);
  }

  // every event id already consumed by a completed request. The column is globally unique, so this
  // set is global too — a user-local view would let two accounts sharing one on-chain address pick
  // the same event and dead-lock the second one against the unique index
  async getConsumedSettlementEventIds(): Promise<string[]> {
    return this.transactionRequestRepo
      .find({ where: { settlementEventId: Not(IsNull()) }, select: { settlementEventId: true } })
      .then((requests) => requests.map((r) => r.settlementEventId));
  }

  // settlement txs of requests completed before the event id was recorded, for every account sharing
  // this on-chain address. Per address, not per user: `user.address` is unique only case-sensitively,
  // so two accounts can share one address and see the same indexer history — and a legacy row carries
  // no event id the global set could block. Not global either: a batch tx pays out to several
  // addresses, and only this one's share of it is unaccountable
  async getLegacySettlementTxIds(address: string): Promise<string[]> {
    return this.transactionRequestRepo
      .createQueryBuilder('request')
      .innerJoin('request.user', 'user')
      .select('request.settlementTxId', 'settlementTxId')
      .where('LOWER(user.address) = LOWER(:address)', { address })
      .andWhere('request.settlementTxId IS NOT NULL')
      .andWhere('request.settlementEventId IS NULL')
      .getRawMany<{ settlementTxId: string }>()
      .then((rows) => rows.map((r) => r.settlementTxId));
  }

  async updateEstimatedAmount(id: number, estimatedAmount: number): Promise<void> {
    await this.transactionRequestRepo.update(id, { estimatedAmount });
  }

  async extendTransactionRequest(txRequest: TransactionRequest): Promise<TransactionRequestExtended> {
    const sourceAssetEntity =
      txRequest.type === TransactionRequestType.BUY
        ? await this.fiatService.getFiat(txRequest.sourceId)
        : await this.assetService.getAssetById(txRequest.sourceId);

    const targetAssetEntity =
      txRequest.type === TransactionRequestType.SELL
        ? await this.fiatService.getFiat(txRequest.targetId)
        : await this.assetService.getAssetById(txRequest.targetId);

    const transactionRequestExtended = Object.assign(txRequest, { sourceAssetEntity, targetAssetEntity });

    switch (txRequest.type) {
      case TransactionRequestType.BUY:
        return Object.assign(transactionRequestExtended, {
          route: await this.buyService.get(undefined, txRequest.routeId),
        });

      case TransactionRequestType.SELL:
        return Object.assign(transactionRequestExtended, {
          route: await this.sellService.get(undefined, txRequest.routeId),
        });

      case TransactionRequestType.SWAP:
        return Object.assign(transactionRequestExtended, {
          route: await this.swapService.get(undefined, txRequest.routeId),
        });
    }
  }

  async confirmTransactionRequest(txRequest: TransactionRequest, aktionariatResponse?: string): Promise<void> {
    await this.transactionRequestRepo.update(txRequest.id, {
      status: TransactionRequestStatus.WAITING_FOR_PAYMENT,
      ...(aktionariatResponse && { aktionariatResponse }),
    });
  }

  async getActiveDepositAddresses(created: Date, blockchain: Blockchain): Promise<string[]> {
    return this.transactionRequestRepo
      .createQueryBuilder('tr')
      .select('d.address', 'address')
      .distinct()
      .innerJoin(DepositRoute, 'dr', 'tr.routeId = dr.id')
      .innerJoin(Deposit, 'd', 'dr.depositId = d.id')
      .leftJoin(CustodyOrder, 'co', 'co.transactionRequestId = tr.id')
      .where('tr.type IN (:...types)', { types: [TransactionRequestType.SELL, TransactionRequestType.SWAP] })
      .andWhere('tr.status = :trStatus', { trStatus: TransactionRequestStatus.CREATED })
      .andWhere('(tr.created > :created OR co.status = :coStatus)', {
        created,
        coStatus: CustodyOrderStatus.IN_PROGRESS,
      })
      .andWhere('d.blockchains LIKE :blockchain', { blockchain: `%${blockchain}%` })
      .getRawMany<{ address: string }>()
      .then((transactionRequests) => transactionRequests.map((deposit) => deposit.address));
  }

  async getByAssetId(assetId: number, limit = 50, offset = 0): Promise<TransactionRequest[]> {
    return this.transactionRequestRepo.find({
      where: [
        { type: TransactionRequestType.BUY, targetId: assetId, isComplete: false },
        { type: TransactionRequestType.SELL, sourceId: assetId, isComplete: false },
      ],
      order: { created: 'DESC' },
      take: limit,
      skip: offset,
      relations: { user: true },
    });
  }

  // --- HELPER METHODS --- //

  private currentStatus(entity: TransactionRequest, expiryDate: Date): TransactionRequestStatus {
    if (entity.isComplete || entity.transaction) return TransactionRequestStatus.COMPLETED;
    if (entity.created < expiryDate) return TransactionRequestStatus.CREATED;
    return TransactionRequestStatus.WAITING_FOR_PAYMENT;
  }
}
