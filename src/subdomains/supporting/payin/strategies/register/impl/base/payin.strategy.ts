import { v4 as uuid } from 'uuid';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Price } from 'src/integration/exchange/dto/price.dto';
import { PayInFactory } from 'src/subdomains/supporting/payin/factories/payin.factory';
import { PayInEntry } from 'src/subdomains/supporting/payin/interfaces';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PriceRequestContext } from 'src/subdomains/supporting/pricing/enums';
import { PriceRequest, PriceResult } from 'src/subdomains/supporting/pricing/interfaces';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';

export interface PayInInputLog {
  recoveredRecords: { address: string; txId: string }[];
  newRecords: { address: string; txId: string }[];
}
export abstract class PayInStrategy {
  constructor(
    protected readonly pricingService: PricingService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
  ) {}

  abstract checkPayInEntries(): Promise<void>;

  protected async createPayInAndSave(transaction: PayInEntry, referencePrices: Price[]): Promise<void> {
    const payIn = this.payInFactory.createFromEntry(transaction, referencePrices);
    await this.payInRepository.save(payIn);
  }

  protected async getReferencePrices(entries: PayInEntry[]): Promise<Price[]> {
    const referenceAssetPairs = [
      ...new Set([...entries.map((p) => `${p.asset.dexName}/BTC`), ...entries.map((p) => `${p.asset.dexName}/USD`)]),
    ].map((assets) => assets.split('/'));

    const prices = await Promise.all<PriceResult>(
      referenceAssetPairs.map(async (pair) => {
        const priceRequest = this.createPriceRequest(pair);

        return this.pricingService.getPrice(priceRequest).catch((e) => {
          console.error('Failed to get price:', e);
          return undefined;
        });
      }),
    );

    return prices.filter((p) => p).map((p) => p.price);
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

  private createPriceRequest(currencyPair: string[]): PriceRequest {
    const correlationId = 'PayInEntries' + uuid();
    return { context: PriceRequestContext.PAY_IN, correlationId, from: currencyPair[0], to: currencyPair[1] };
  }
}
