import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeTx, ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
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
import {
  FlowGroupDto,
  FlowItemDto,
  OverviewQuery,
  PositionDto,
  ReconciliationDto,
  ReconciliationOverviewDto,
  ReconciliationQuery,
} from '../dto/reconciliation.dto';

const EXCHANGE_BLOCKCHAINS: Blockchain[] = [Blockchain.KRAKEN, Blockchain.BINANCE, Blockchain.XT, Blockchain.MEXC];

const BLOCKCHAIN_WALLET_ENV: Partial<Record<Blockchain, string>> = {
  [Blockchain.BITCOIN]: 'BTC_OUT_WALLET_ADDRESS',
  [Blockchain.ETHEREUM]: 'ETH_WALLET_ADDRESS',
  [Blockchain.ARBITRUM]: 'ARBITRUM_WALLET_ADDRESS',
  [Blockchain.OPTIMISM]: 'OPTIMISM_WALLET_ADDRESS',
  [Blockchain.BASE]: 'BASE_WALLET_ADDRESS',
  [Blockchain.POLYGON]: 'POLYGON_WALLET_ADDRESS',
  [Blockchain.BINANCE_SMART_CHAIN]: 'BINANCE_SMART_CHAIN_WALLET_ADDRESS',
  [Blockchain.GNOSIS]: 'GNOSIS_WALLET_ADDRESS',
  [Blockchain.MONERO]: 'MONERO_WALLET_ADDRESS',
  [Blockchain.FIRO]: 'FIRO_WALLET_ADDRESS',
  [Blockchain.SOLANA]: 'SOL_WALLET_ADDRESS',
};

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
  private readonly logger = new DfxLogger(ReconciliationService);

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

    // Resolve counter-account names to asset IDs
    const allGroups = [...inflows, ...outflows];
    const counterNames = [...new Set(allGroups.map((g) => g.counterAccount).filter(Boolean))] as string[];
    if (counterNames.length > 0) {
      const counterAssets = await this.assetRepo
        .createQueryBuilder('a')
        .where('a.uniqueName IN (:...names)', { names: counterNames })
        .getMany();
      const nameToId = new Map(counterAssets.map((a) => [a.uniqueName, a.id]));
      for (const g of allGroups) {
        if (g.counterAccount) g.counterAssetId = nameToId.get(g.counterAccount);
      }
    }

    return {
      asset: { id: asset.id, uniqueName: asset.uniqueName, blockchain: asset.blockchain, type: asset.type },
      period: { from: query.from, to: query.to, actualFrom: startLog?.created, actualTo: endLog?.created },
      startBalance,
      endBalance,
      inflows: inflows.filter((g) => g.count > 0 && g.totalAmount !== 0),
      outflows: outflows.filter((g) => g.count > 0 && g.totalAmount !== 0),
      totalInflows,
      totalOutflows,
      expectedEndBalance,
      difference: Util.round(endBalance - expectedEndBalance, 8),
    };
  }

  async getOverview(query: OverviewQuery): Promise<ReconciliationOverviewDto> {
    const [startLog, endLog] = await Promise.all([
      this.getFinancialLogAt(query.from, 'before'),
      this.getFinancialLogAt(query.to, 'before'),
    ]);

    // Extract all asset balances from both logs
    const startBalances = this.extractAllBalances(startLog);
    const endBalances = this.extractAllBalances(endLog);

    // Collect all asset IDs with non-zero balance
    const allAssetIds = [...new Set([...startBalances.keys(), ...endBalances.keys()])];
    if (allAssetIds.length === 0)
      return {
        period: { from: query.from, to: query.to, actualFrom: startLog?.created, actualTo: endLog?.created },
        positions: [],
      };

    // Load asset metadata
    const assets = await this.assetRepo
      .createQueryBuilder('a')
      .where('a.id IN (:...ids)', { ids: allAssetIds })
      .getMany();
    const assetMap = new Map(assets.map((a) => [a.id, a]));

    // Build positions with full reconciliation for each asset
    const flowFrom = startLog?.created ?? query.from;
    const flowTo = endLog?.created ?? query.to;

    const positions: PositionDto[] = [];
    for (const id of allAssetIds) {
      const asset = assetMap.get(id);
      if (!asset) continue;

      const start = startBalances.get(id) ?? 0;
      const end = endBalances.get(id) ?? 0;
      if (start === 0 && end === 0) continue;

      const category = this.categorizeAsset(asset);

      let totalIn = 0;
      let totalOut = 0;
      try {
        const [inflows, outflows] = await this.getFlows(asset, category, flowFrom, flowTo);
        totalIn = Util.round(
          inflows.reduce((s, g) => s + g.totalAmount, 0),
          8,
        );
        totalOut = Util.round(
          outflows.reduce((s, g) => s + g.totalAmount, 0),
          8,
        );
      } catch (e) {
        this.logger.warn(`Failed to get flows for ${asset.uniqueName}:`, e);
      }

      const expected = Util.round(start + totalIn - totalOut, 8);

      positions.push({
        asset: { id: asset.id, uniqueName: asset.uniqueName, blockchain: asset.blockchain, type: asset.type },
        category,
        startBalance: start,
        endBalance: end,
        totalInflows: totalIn,
        totalOutflows: totalOut,
        expectedEndBalance: expected,
        difference: Util.round(end - expected, 8),
      });
    }

    // Sort by category, then by uniqueName
    const categoryOrder = { blockchain: 0, exchange: 1, bank: 2 };
    positions.sort(
      (a, b) =>
        categoryOrder[a.category] - categoryOrder[b.category] || a.asset.uniqueName.localeCompare(b.asset.uniqueName),
    );

    return {
      period: { from: query.from, to: query.to, actualFrom: startLog?.created, actualTo: endLog?.created },
      positions,
    };
  }

  // --- PRIVATE HELPERS --- //

  private extractAllBalances(log: Log | undefined): Map<number, number> {
    const balances = new Map<number, number>();
    if (!log) return balances;

    try {
      const data: FinanceLog = JSON.parse(log.message);
      if (!data.assets) return balances;

      for (const [idStr, assetLog] of Object.entries(data.assets)) {
        const total = assetLog?.plusBalance?.liquidity?.liquidityBalance?.total;
        if (total != null && total !== 0) balances.set(Number(idStr), total);
      }
    } catch (e) {
      this.logger.warn(`Failed to parse financial log ${log.id}:`, e);
    }

    return balances;
  }

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
      return assetLog?.plusBalance?.liquidity?.liquidityBalance?.total ?? 0;
    } catch (e) {
      this.logger.warn(`Failed to parse financial log ${log.id}:`, e);
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
      this.getExchangeWithdrawalsForBlockchain(asset.blockchain, asset.dexName, from, to),
    ]);

    // Exclude exchange withdrawals that overlap with LM deficit orders
    const lmCorrelationIds = new Set(lmDeficitOrders.flatMap((o) => o.allCorrelationIds));
    const nonLmWithdrawals = exchangeWithdrawals.filter((tx) => !lmCorrelationIds.has(tx.externalId));

    // Resolve blockchain txIds for LM orders via ExchangeTx
    const allLmOrders = [...lmDeficitOrders, ...lmRedundancyOrders];
    const allCorrelationIds = allLmOrders.map((o) => o.correlationId).filter(Boolean);
    const lmTxMap = new Map<string, string>();
    if (allCorrelationIds.length > 0) {
      const txs = await this.exchangeTxRepo
        .createQueryBuilder('tx')
        .where('tx.externalId IN (:...ids)', { ids: allCorrelationIds })
        .andWhere('tx.txId IS NOT NULL')
        .getMany();
      for (const tx of txs) lmTxMap.set(tx.externalId, tx.txId);
    }

    const dn = asset.dexName;
    const lmCounterAccount = (o: LiquidityManagementOrder): string => {
      const system = o.action?.system ?? 'Unknown';
      if (system === 'DfxDex') {
        try {
          const dest = JSON.parse(o.action?.params ?? '{}').destinationSystem;
          if (dest) return `${dest}/${dn}`;
        } catch {}
      }
      return `${system}/${dn}`;
    };

    const inflows: FlowGroupDto[] = [
      ...this.buildFlowGroups(
        'LmDeficit',
        lmDeficitOrders,
        (o) => ({
          id: o.id,
          date: o.updated,
          amount: o.outputAmount ?? 0,
          reference: (o.correlationId && lmTxMap.get(o.correlationId)) ?? o.correlationId,
        }),
        lmCounterAccount,
      ),
      ...this.buildFlowGroups(
        'ExchangeWithdrawal',
        nonLmWithdrawals,
        (tx) => ({
          id: tx.id,
          date: tx.externalCreated ?? tx.created,
          amount: tx.amount ?? 0,
          reference: tx.txId,
        }),
        (tx) => `${tx.exchange ?? 'Unknown'}/${dn}`,
      ),
      this.buildFlowGroup(
        'CryptoInput',
        cryptoInputs,
        (ci) => ({
          id: ci.id,
          date: ci.updated,
          amount: ci.amount ?? 0,
          reference: ci.inTxId,
        }),
        'Kunden',
      ),
    ];

    const outflows: FlowGroupDto[] = [
      this.buildFlowGroup(
        'PayoutOrder',
        payoutOrders,
        (po) => ({
          id: po.id,
          date: po.updated,
          amount: (po.amount ?? 0) + (po.payoutFeeAmount ?? 0),
          reference: po.payoutTxId,
        }),
        'Kunden',
      ),
      ...this.buildFlowGroups(
        'LmRedundancy',
        lmRedundancyOrders,
        (o) => ({
          id: o.id,
          date: o.updated,
          amount: o.inputAmount ?? 0,
          reference: (o.correlationId && lmTxMap.get(o.correlationId)) ?? o.correlationId,
        }),
        lmCounterAccount,
      ),
    ];

    return [inflows, outflows];
  }

  // --- EXCHANGE FLOWS --- //

  private async getExchangeFlows(asset: Asset, from: Date, to: Date): Promise<[FlowGroupDto[], FlowGroupDto[]]> {
    const exchange = asset.blockchain;
    const dexName = asset.dexName;

    // Find the primary blockchain asset for deposits/withdrawals counter-account
    const blockchainAsset = await this.assetRepo
      .createQueryBuilder('a')
      .where('a.dexName = :dexName', { dexName })
      .andWhere('a.uniqueName LIKE :pattern', { pattern: `%/${dexName}` })
      .andWhere('a.blockchain NOT IN (:...excluded)', {
        excluded: [...EXCHANGE_BLOCKCHAINS, ...BANK_BLOCKCHAINS],
      })
      .orderBy('a.id', 'ASC')
      .getOne();
    const blockchainCounter = blockchainAsset?.uniqueName ?? `Blockchain/${dexName}`;

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
      this.buildFlowGroup('Deposit', deposits, (tx) => toItem(tx, (t) => t.amount ?? 0), blockchainCounter),
      ...this.buildFlowGroups(
        'TradeBuy',
        baseBuys,
        (tx) => toItem(tx, (t) => t.amount ?? 0),
        (tx) => `${exchange}/${getQuote(tx) ?? 'Unknown'}`,
      ),
      ...this.buildFlowGroups(
        'TradeSellQuoteInflow',
        quoteSells,
        (tx) => toItem(tx, (t) => t.cost ?? 0),
        (tx) => `${exchange}/${getBase(tx) ?? 'Unknown'}`,
      ),
    ];

    const outflows: FlowGroupDto[] = [
      this.buildFlowGroup('Withdrawal', withdrawals, (tx) => toItem(tx, (t) => t.amount ?? 0), blockchainCounter),
      ...this.buildFlowGroups(
        'TradeSell',
        baseSells,
        (tx) => toItem(tx, (t) => t.amount ?? 0),
        (tx) => `${exchange}/${getQuote(tx) ?? 'Unknown'}`,
      ),
      ...this.buildFlowGroups(
        'TradeBuyQuoteOutflow',
        quoteBuys,
        (tx) => toItem(tx, (t) => t.cost ?? 0),
        (tx) => `${exchange}/${getBase(tx) ?? 'Unknown'}`,
      ),
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
      ...this.buildFlowGroups(
        'BankCredit',
        credits,
        (tx) => ({
          id: tx.id,
          date: tx.bookingDate ?? tx.created,
          amount: tx.amount ?? 0,
          reference: tx.accountServiceRef,
        }),
        (tx) => tx.type ?? 'Sonstige',
      ),
    ];

    const outflows: FlowGroupDto[] = [
      ...this.buildFlowGroups(
        'BankDebit',
        debits,
        (tx) => ({
          id: tx.id,
          date: tx.bookingDate ?? tx.created,
          amount: tx.amount ?? 0,
          reference: tx.accountServiceRef,
        }),
        (tx) => tx.type ?? 'Sonstige',
      ),
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
      .leftJoinAndSelect('lmOrder.action', 'action')
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

  private async getExchangeWithdrawalsForBlockchain(
    blockchain: Blockchain,
    dexName: string,
    from: Date,
    to: Date,
  ): Promise<ExchangeTx[]> {
    const hotWallet = BLOCKCHAIN_WALLET_ENV[blockchain] ? process.env[BLOCKCHAIN_WALLET_ENV[blockchain]!] : undefined;

    const qb = this.exchangeTxRepo
      .createQueryBuilder('tx')
      .where('tx.type = :type', { type: ExchangeTxType.WITHDRAWAL })
      .andWhere('tx.currency = :currency', { currency: dexName })
      .andWhere('tx.txId IS NOT NULL')
      .andWhere('tx.address NOT LIKE :lnPrefix', { lnPrefix: 'lnbc%' })
      .andWhere('tx.created BETWEEN :from AND :to', { from, to });

    if (hotWallet) {
      qb.andWhere('tx.address = :address', { address: hotWallet });
    }

    return qb.getMany();
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

  private buildFlowGroup<T>(
    type: string,
    items: T[],
    mapper: (item: T) => FlowItemDto,
    counterAccount?: string,
  ): FlowGroupDto {
    const flowItems = items.map(mapper);
    return {
      type,
      counterAccount,
      count: flowItems.length,
      totalAmount: Util.round(
        flowItems.reduce((sum, item) => sum + item.amount, 0),
        8,
      ),
      items: flowItems,
    };
  }

  private buildFlowGroups<T>(
    type: string,
    items: T[],
    mapper: (item: T) => FlowItemDto,
    counterAccountFn: (item: T) => string,
  ): FlowGroupDto[] {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
      const ca = counterAccountFn(item);
      if (!grouped.has(ca)) grouped.set(ca, []);
      grouped.get(ca)!.push(item);
    }
    return Array.from(grouped.entries()).map(([ca, groupItems]) => this.buildFlowGroup(type, groupItems, mapper, ca));
  }
}
