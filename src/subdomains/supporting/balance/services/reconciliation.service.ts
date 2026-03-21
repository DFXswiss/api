import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeTx, ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import {
  LiquidityManagementOrderStatus,
  LiquidityOptimizationType,
} from 'src/subdomains/core/liquidity-management/enums';
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import { BankTx, BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { FinanceLog } from 'src/subdomains/supporting/log/dto/log.dto';
import { Log, LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayoutOrder, PayoutOrderStatus } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { FlowGroupDto, FlowItemDto, ReconciliationDto, ReconciliationQuery } from '../dto/reconciliation.dto';

const EXCHANGE_BLOCKCHAINS: Blockchain[] = [Blockchain.KRAKEN, Blockchain.BINANCE, Blockchain.XT, Blockchain.MEXC];

const BANK_BLOCKCHAINS: Blockchain[] = [
  Blockchain.MAERKI_BAUMANN,
  Blockchain.OLKYPAY,
  Blockchain.CHECKOUT,
  Blockchain.SUMIXX,
  Blockchain.YAPEAL,
];

type AssetCategory = 'blockchain' | 'exchange' | 'bank';

@Injectable()
export class ReconciliationService {
  constructor(
    @InjectRepository(Log) private readonly logRepo: Repository<Log>,
    @InjectRepository(Asset) private readonly assetRepo: Repository<Asset>,
    @InjectRepository(LiquidityManagementOrder) private readonly lmOrderRepo: Repository<LiquidityManagementOrder>,
    @InjectRepository(PayoutOrder) private readonly payoutOrderRepo: Repository<PayoutOrder>,
    @InjectRepository(ExchangeTx) private readonly exchangeTxRepo: Repository<ExchangeTx>,
    @InjectRepository(BankTx) private readonly bankTxRepo: Repository<BankTx>,
    @InjectRepository(CryptoInput) private readonly cryptoInputRepo: Repository<CryptoInput>,
  ) {}

  async getReconciliation(query: ReconciliationQuery): Promise<ReconciliationDto> {
    const asset = await this.assetRepo.findOne({ where: { id: query.assetId }, relations: ['bank'] });
    if (!asset) throw new NotFoundException('Asset not found');

    const category = this.categorizeAsset(asset);

    const [startLog, endLog] = await Promise.all([
      this.getFinancialLogAt(query.from, 'before'),
      this.getFinancialLogAt(query.to, 'before'),
    ]);

    const startBalance = this.extractBalance(startLog, query.assetId);
    const endBalance = this.extractBalance(endLog, query.assetId);

    const flowFrom = startLog?.created ?? query.from;
    const flowTo = endLog?.created ?? query.to;

    const [inflows, outflows] = await this.getFlows(asset, category, flowFrom, flowTo);

    const totalInflows = Util.round(
      inflows.reduce((sum, g) => sum + g.totalAmount, 0),
      8,
    );
    const totalOutflows = Util.round(
      outflows.reduce((sum, g) => sum + g.totalAmount, 0),
      8,
    );
    const expectedEndBalance = Util.round(startBalance + totalInflows - totalOutflows, 8);

    return {
      asset: { id: asset.id, uniqueName: asset.uniqueName, blockchain: asset.blockchain, type: asset.type },
      period: { from: query.from, to: query.to, actualFrom: startLog?.created, actualTo: endLog?.created },
      startBalance,
      endBalance,
      inflows: inflows.filter((g) => g.count > 0),
      outflows: outflows.filter((g) => g.count > 0),
      totalInflows,
      totalOutflows,
      expectedEndBalance,
      difference: Util.round(endBalance - expectedEndBalance, 8),
    };
  }

  // --- PRIVATE HELPERS --- //

  private categorizeAsset(asset: Asset): AssetCategory {
    if (EXCHANGE_BLOCKCHAINS.includes(asset.blockchain)) return 'exchange';
    if (BANK_BLOCKCHAINS.includes(asset.blockchain)) return 'bank';
    return 'blockchain';
  }

  private async getFinancialLogAt(targetDate: Date, direction: 'before' | 'after'): Promise<Log | undefined> {
    return this.logRepo.findOne({
      where: {
        system: 'LogService',
        subsystem: 'FinancialDataLog',
        severity: LogSeverity.INFO,
        created: direction === 'before' ? LessThanOrEqual(targetDate) : MoreThanOrEqual(targetDate),
      },
      order: { created: direction === 'before' ? 'DESC' : 'ASC' },
    });
  }

  private extractBalance(log: Log | undefined, assetId: number): number {
    if (!log) return 0;

    try {
      const data: FinanceLog = JSON.parse(log.message);
      const assetLog = data.assets?.[assetId.toString()];
      return assetLog?.plusBalance?.liquidity?.liquidityBalance?.total ?? assetLog?.plusBalance?.liquidity?.total ?? 0;
    } catch {
      return 0;
    }
  }

  private async getFlows(
    asset: Asset,
    category: AssetCategory,
    from: Date,
    to: Date,
  ): Promise<[FlowGroupDto[], FlowGroupDto[]]> {
    switch (category) {
      case 'blockchain':
        return this.getBlockchainFlows(asset, from, to);
      case 'exchange':
        return this.getExchangeFlows(asset, from, to);
      case 'bank':
        return this.getBankFlows(asset, from, to);
    }
  }

  // --- BLOCKCHAIN FLOWS --- //

  private async getBlockchainFlows(asset: Asset, from: Date, to: Date): Promise<[FlowGroupDto[], FlowGroupDto[]]> {
    const [lmDeficitOrders, lmRedundancyOrders, payoutOrders, cryptoInputs, exchangeWithdrawals] = await Promise.all([
      this.getLmOrders(asset.id, LiquidityOptimizationType.DEFICIT, from, to),
      this.getLmOrders(asset.id, LiquidityOptimizationType.REDUNDANCY, from, to),
      this.getPayoutOrders(asset.id, from, to),
      this.getCryptoInputs(asset.id, from, to),
      this.getExchangeWithdrawalsForBlockchain(asset.dexName, from, to),
    ]);

    // Exclude exchange withdrawals that overlap with LM deficit orders
    const lmCorrelationIds = new Set(lmDeficitOrders.flatMap((o) => o.allCorrelationIds));
    const nonLmWithdrawals = exchangeWithdrawals.filter((tx) => !lmCorrelationIds.has(tx.externalId));

    const inflows: FlowGroupDto[] = [
      this.buildFlowGroup('LmDeficit', lmDeficitOrders, (o) => ({
        id: o.id,
        date: o.updated,
        amount: o.outputAmount ?? 0,
        reference: o.correlationId,
      })),
      this.buildFlowGroup('ExchangeWithdrawal', nonLmWithdrawals, (tx) => ({
        id: tx.id,
        date: tx.externalCreated ?? tx.created,
        amount: tx.amount ?? 0,
        reference: tx.txId,
      })),
      this.buildFlowGroup('CryptoInput', cryptoInputs, (ci) => ({
        id: ci.id,
        date: ci.updated,
        amount: ci.amount ?? 0,
        reference: ci.inTxId,
      })),
    ];

    const outflows: FlowGroupDto[] = [
      this.buildFlowGroup('PayoutOrder', payoutOrders, (po) => ({
        id: po.id,
        date: po.updated,
        amount: (po.amount ?? 0) + (po.payoutFeeAmount ?? 0),
        reference: po.payoutTxId,
      })),
      this.buildFlowGroup('LmRedundancy', lmRedundancyOrders, (o) => ({
        id: o.id,
        date: o.updated,
        amount: o.inputAmount ?? 0,
        reference: o.correlationId,
      })),
    ];

    return [inflows, outflows];
  }

  // --- EXCHANGE FLOWS --- //

  private async getExchangeFlows(asset: Asset, from: Date, to: Date): Promise<[FlowGroupDto[], FlowGroupDto[]]> {
    const exchange = asset.blockchain;
    const dexName = asset.dexName;

    const exchangeTxs = await this.exchangeTxRepo
      .createQueryBuilder('tx')
      .where('tx.exchange = :exchange', { exchange })
      .andWhere('tx.created BETWEEN :from AND :to', { from, to })
      .getMany();

    const deposits = exchangeTxs.filter((tx) => tx.type === ExchangeTxType.DEPOSIT && tx.currency === dexName);
    const withdrawals = exchangeTxs.filter((tx) => tx.type === ExchangeTxType.WITHDRAWAL && tx.currency === dexName);
    const trades = exchangeTxs.filter((tx) => tx.type === ExchangeTxType.TRADE);

    // Parse base/quote from symbol or currency/pair fields
    const getBase = (tx: ExchangeTx): string | undefined => tx.currency ?? this.parseSymbol(tx.symbol)?.[0];
    const getQuote = (tx: ExchangeTx): string | undefined =>
      this.getQuoteCurrency(tx) ?? this.parseSymbol(tx.symbol)?.[1];

    // Base-side trades (base currency = tracked asset)
    const baseBuys = trades.filter((tx) => getBase(tx) === dexName && tx.side?.toLowerCase() === 'buy');
    const baseSells = trades.filter((tx) => getBase(tx) === dexName && tx.side?.toLowerCase() === 'sell');

    // Quote-side trades (quote currency = tracked asset)
    const quoteBuys = trades.filter(
      (tx) => getBase(tx) !== dexName && getQuote(tx) === dexName && tx.side?.toLowerCase() === 'buy',
    );
    const quoteSells = trades.filter(
      (tx) => getBase(tx) !== dexName && getQuote(tx) === dexName && tx.side?.toLowerCase() === 'sell',
    );

    // Fee outflows in this asset (from trades, withdrawals, and deposits)
    const feeTxs = exchangeTxs.filter((tx) => tx.feeCurrency === dexName && (tx.feeAmount ?? 0) > 0);

    const toItem = (tx: ExchangeTx, amountFn: (tx: ExchangeTx) => number): FlowItemDto => ({
      id: tx.id,
      date: tx.externalCreated ?? tx.created,
      amount: amountFn(tx),
      reference: tx.externalId,
    });

    const inflows: FlowGroupDto[] = [
      this.buildFlowGroup('Deposit', deposits, (tx) => toItem(tx, (t) => t.amount ?? 0)),
      this.buildFlowGroup('TradeBuy', baseBuys, (tx) => toItem(tx, (t) => t.amount ?? 0)),
      this.buildFlowGroup('TradeSellQuoteInflow', quoteSells, (tx) => toItem(tx, (t) => t.cost ?? 0)),
    ];

    const outflows: FlowGroupDto[] = [
      this.buildFlowGroup('Withdrawal', withdrawals, (tx) => toItem(tx, (t) => t.amount ?? 0)),
      this.buildFlowGroup('TradeSell', baseSells, (tx) => toItem(tx, (t) => t.amount ?? 0)),
      this.buildFlowGroup('TradeBuyQuoteOutflow', quoteBuys, (tx) => toItem(tx, (t) => t.cost ?? 0)),
      this.buildFlowGroup('Fee', feeTxs, (tx) => toItem(tx, (t) => t.feeAmount ?? 0)),
    ];

    return [inflows, outflows];
  }

  // --- BANK FLOWS --- //

  private async getBankFlows(asset: Asset, from: Date, to: Date): Promise<[FlowGroupDto[], FlowGroupDto[]]> {
    const bankIban = asset.bank?.iban;
    if (!bankIban) throw new NotFoundException(`No bank account found for asset ${asset.uniqueName}`);

    const bankTxs = await this.bankTxRepo
      .createQueryBuilder('tx')
      .where('tx.accountIban = :iban', { iban: bankIban })
      .andWhere('tx.created BETWEEN :from AND :to', { from, to })
      .getMany();

    const credits = bankTxs.filter((tx) => tx.creditDebitIndicator === BankTxIndicator.CREDIT);
    const debits = bankTxs.filter((tx) => tx.creditDebitIndicator === BankTxIndicator.DEBIT);

    const inflows: FlowGroupDto[] = [
      this.buildFlowGroup('BankCredit', credits, (tx) => ({
        id: tx.id,
        date: tx.bookingDate ?? tx.created,
        amount: tx.amount ?? 0,
        reference: tx.accountServiceRef,
      })),
    ];

    const outflows: FlowGroupDto[] = [
      this.buildFlowGroup('BankDebit', debits, (tx) => ({
        id: tx.id,
        date: tx.bookingDate ?? tx.created,
        amount: tx.amount ?? 0,
        reference: tx.accountServiceRef,
      })),
    ];

    return [inflows, outflows];
  }

  // --- QUERY METHODS --- //

  private async getLmOrders(
    assetId: number,
    pipelineType: LiquidityOptimizationType,
    from: Date,
    to: Date,
  ): Promise<LiquidityManagementOrder[]> {
    return this.lmOrderRepo
      .createQueryBuilder('lmOrder')
      .innerJoin('lmOrder.pipeline', 'pipeline')
      .innerJoin('pipeline.rule', 'rule')
      .innerJoin('rule.targetAsset', 'targetAsset')
      .where('targetAsset.id = :assetId', { assetId })
      .andWhere('pipeline.type = :type', { type: pipelineType })
      .andWhere('lmOrder.status = :status', { status: LiquidityManagementOrderStatus.COMPLETE })
      .andWhere('lmOrder.updated BETWEEN :from AND :to', { from, to })
      .getMany();
  }

  private async getPayoutOrders(assetId: number, from: Date, to: Date): Promise<PayoutOrder[]> {
    return this.payoutOrderRepo
      .createQueryBuilder('po')
      .innerJoin('po.asset', 'asset')
      .where('asset.id = :assetId', { assetId })
      .andWhere('po.status = :status', { status: PayoutOrderStatus.COMPLETE })
      .andWhere('po.updated BETWEEN :from AND :to', { from, to })
      .getMany();
  }

  private async getCryptoInputs(assetId: number, from: Date, to: Date): Promise<CryptoInput[]> {
    return this.cryptoInputRepo
      .createQueryBuilder('ci')
      .innerJoin('ci.asset', 'asset')
      .where('asset.id = :assetId', { assetId })
      .andWhere('ci.status IN (:...statuses)', {
        statuses: [PayInStatus.FORWARD_CONFIRMED, PayInStatus.COMPLETED],
      })
      .andWhere('ci.updated BETWEEN :from AND :to', { from, to })
      .getMany();
  }

  private async getExchangeWithdrawalsForBlockchain(dexName: string, from: Date, to: Date): Promise<ExchangeTx[]> {
    return this.exchangeTxRepo
      .createQueryBuilder('tx')
      .where('tx.type = :type', { type: ExchangeTxType.WITHDRAWAL })
      .andWhere('tx.currency = :currency', { currency: dexName })
      .andWhere('tx.txId IS NOT NULL')
      .andWhere("tx.address NOT LIKE 'lnbc%'")
      .andWhere('tx.created BETWEEN :from AND :to', { from, to })
      .getMany();
  }

  private parseSymbol(symbol: string | undefined): [string, string] | undefined {
    if (!symbol?.includes('/')) return undefined;
    const [base, quote] = symbol.split('/');
    return base && quote ? [base, quote] : undefined;
  }

  private getQuoteCurrency(trade: ExchangeTx): string | undefined {
    if (trade.pair && trade.currency) {
      const pair = trade.pair.replace('/', '');
      return pair.startsWith(trade.currency) ? pair.substring(trade.currency.length) : undefined;
    }
    return this.parseSymbol(trade.symbol)?.[1];
  }

  private buildFlowGroup<T>(type: string, items: T[], mapper: (item: T) => FlowItemDto): FlowGroupDto {
    const flowItems = items.map(mapper);
    return {
      type,
      count: flowItems.length,
      totalAmount: Util.round(
        flowItems.reduce((sum, item) => sum + item.amount, 0),
        8,
      ),
      items: flowItems,
    };
  }
}
