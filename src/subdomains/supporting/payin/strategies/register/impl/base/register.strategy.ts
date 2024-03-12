import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { CheckLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInFactory } from 'src/subdomains/supporting/payin/factories/payin.factory';
import { PayInEntry } from 'src/subdomains/supporting/payin/interfaces';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { TransactionSourceType } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { v4 as uuid } from 'uuid';
import { RegisterStrategyRegistry } from './register.strategy-registry';

export interface PayInInputLog {
  newRecords: { address: string; txId: string }[];
}

const SkipTestSwapAssets = ['ZCHF'];

export abstract class RegisterStrategy implements OnModuleInit, OnModuleDestroy {
  protected abstract readonly logger: DfxLogger;

  @Inject() private readonly dexService: DexService;
  @Inject() private readonly payInFactory: PayInFactory;
  @Inject() private readonly registry: RegisterStrategyRegistry;
  @Inject() private readonly pricingService: PricingService;
  @Inject() private readonly transactionService: TransactionService;

  constructor(protected readonly payInRepository: PayInRepository) {}

  onModuleInit() {
    this.registry.add(this.blockchain, this);
  }

  onModuleDestroy() {
    this.registry.remove(this.blockchain);
  }

  abstract get blockchain(): Blockchain;

  abstract addReferenceAmounts(entries: PayInEntry[] | CryptoInput[]): Promise<void>;
  abstract doAmlCheck(payIn: CryptoInput, route: Staking | Sell | CryptoRoute): Promise<CheckStatus> | CheckStatus;

  protected async createPayInsAndSave(transactions: PayInEntry[], log: PayInInputLog): Promise<void> {
    const payIns = transactions.map((t) => this.payInFactory.createFromEntry(t));

    for (const payIn of payIns) {
      await this.payInRepository.save(payIn);
      if (!DisabledProcess(Process.CREATE_TRANSACTION))
        payIn.transaction = await this.transactionService.create({
          sourceType: TransactionSourceType.CRYPTO_INPUT,
        });
    }

    log.newRecords.push(...transactions.map((p) => ({ address: p.address.address, txId: p.txId })));
  }

  protected createNewLogObject(): PayInInputLog {
    return {
      newRecords: [],
    };
  }

  protected printInputLog(log: PayInInputLog, blockHeight: number | string, blockchain: Blockchain): void {
    if (log.newRecords.length > 0) {
      this.logger.verbose(
        `Created ${log.newRecords.length} new pay-in entry(ies) after block ${blockHeight} of blockchain ${blockchain}`,
      );
    }
  }

  protected async getReferenceAmount(
    fromAsset: Asset,
    toAsset: Asset,
    entry: CryptoInput | PayInEntry,
  ): Promise<number> {
    if (SkipTestSwapAssets.includes(fromAsset.dexName))
      return this.pricingService.getPrice(fromAsset, toAsset, false).then((p) => p.convert(entry.amount));

    const request = this.createLiquidityRequest(fromAsset, entry.amount, toAsset);
    const liquidity = await this.dexService.checkLiquidity(request);

    return liquidity.target.amount;
  }

  protected async addReferenceAmountsToEntry(
    entry: PayInEntry | CryptoInput,
    btcAmount: number,
    usdtAmount: number,
  ): Promise<void> {
    if (entry instanceof CryptoInput) {
      entry.addReferenceAmounts(btcAmount, usdtAmount);
      await this.payInRepository.save(entry);
    } else {
      entry.btcAmount = btcAmount;
      entry.usdtAmount = usdtAmount;
    }
  }

  protected filterOutPoolPairs(p: PayInEntry): PayInEntry | null {
    if (p == null) return null;

    if (p.asset && p.asset.category === AssetCategory.POOL_PAIR) {
      this.logger.verbose(`Ignoring pool-pair input (${p.amount} ${p.asset.uniqueName})`);
      return null;
    }

    return p;
  }

  private createLiquidityRequest(
    referenceAsset: Asset,
    referenceAmount: number,
    targetAsset: Asset,
  ): CheckLiquidityRequest {
    return {
      context: LiquidityOrderContext.PAY_IN,
      correlationId: uuid(),
      referenceAsset,
      referenceAmount,
      targetAsset,
    };
  }
}
