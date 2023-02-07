import { v4 as uuid } from 'uuid';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { CheckLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInFactory } from 'src/subdomains/supporting/payin/factories/payin.factory';
import { PayInEntry } from 'src/subdomains/supporting/payin/interfaces';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';

export interface PayInInputLog {
  recoveredRecords: { address: string; txId: string }[];
  newRecords: { address: string; txId: string }[];
}
export abstract class RegisterStrategy {
  constructor(
    protected readonly dexService: DexService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
  ) {}

  abstract checkPayInEntries(): Promise<void>;
  abstract addReferenceAmounts(entries: PayInEntry[] | CryptoInput[]): Promise<void>;
  abstract doAmlCheck(payIn: CryptoInput, route: Staking | Sell | CryptoRoute): Promise<AmlCheck> | AmlCheck;

  protected async createPayInAndSave(transaction: PayInEntry): Promise<void> {
    const payIn = this.payInFactory.createFromEntry(transaction);

    await this.payInRepository.save(payIn);
  }

  protected createNewLogObject(): PayInInputLog {
    return {
      recoveredRecords: [],
      newRecords: [],
    };
  }

  protected printInputLog(log: PayInInputLog, blockHeight: number | string, blockchain: Blockchain): void {
    if (log.recoveredRecords.length > 0) {
      console.log(
        `Recovered ${log.recoveredRecords.length} pay-in entry(ies) from last block ${blockHeight} of blockchain ${blockchain}`,
        log.recoveredRecords,
      );
    }

    if (log.newRecords.length > 0) {
      console.log(
        `Created ${log.newRecords.length} new pay-in entry(ies) after block ${blockHeight} of blockchain ${blockchain}`,
        log.newRecords,
      );
    }
  }

  protected async getReferenceAmount(fromAsset: Asset, fromAmount: number, toAsset: Asset): Promise<number> {
    const request = this.createLiquidityRequest(fromAsset, fromAmount, toAsset);
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
      console.log(`Ignoring pool-pair input (${p.amount} ${p.asset}). PayIn entry:`, p);
      return null;
    }

    return p;
  }

  protected filterOutNonSellable(p: PayInEntry): PayInEntry | null {
    if (p == null) return null;

    if (p.asset && !p.asset.sellable) {
      console.log(`Ignoring unsellable input (${p.amount} ${p.asset}). PayIn entry:`, p);
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
