import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import {
  BrokerbotBuyPriceDto,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSharesDto,
} from './dto/realunit-broker.dto';

interface AktionariatPriceResponse {
  priceInCHF: number;
  priceInEUR: number;
  availableShares: number;
}

interface PaymentInstructionsRequest {
  currency: string;
  address: string;
  shares: number;
  price: number;
}

interface PaymentInstructionsResponse {
  reference: string;
  [key: string]: unknown;
}

interface PayAndAllocateRequest {
  amount: number;
  ref: string;
}

@Injectable()
export class RealUnitBlockchainService {
  private readonly priceCache = new AsyncCache<AktionariatPriceResponse>(CacheItemResetPeriod.EVERY_30_SECONDS);

  constructor(private readonly http: HttpService) {}

  private async fetchPrice(): Promise<AktionariatPriceResponse> {
    return this.priceCache.get(
      'price',
      async () => {
        const { url, key } = GetConfig().blockchain.realunit.api;
        return this.http.post<AktionariatPriceResponse>(`${url}/directinvestment/getPrice`, null, {
          headers: { 'x-api-key': key },
        });
      },
      undefined,
      true,
    );
  }

  async getRealUnitPriceChf(): Promise<number> {
    return this.fetchPrice().then((r) => r.priceInCHF);
  }

  async getRealUnitPriceEur(): Promise<number> {
    return this.fetchPrice().then((r) => r.priceInEUR);
  }

  async requestPaymentInstructions(request: PaymentInstructionsRequest): Promise<PaymentInstructionsResponse> {
    const { url, key } = GetConfig().blockchain.realunit.api;
    return this.http.post(`${url}/directinvestment/requestPaymentInstructions`, request, {
      headers: { 'x-api-key': key },
    });
  }

  async payAndAllocate(request: PayAndAllocateRequest): Promise<void> {
    const { url, key } = GetConfig().blockchain.realunit.api;
    await this.http.post(`${url}/directinvestment/payAndAllocate`, request, {
      headers: { 'x-api-key': key },
    });
  }

  // --- Brokerbot Methods ---

  async getBrokerbotPrice(): Promise<BrokerbotPriceDto> {
    const { priceInCHF, availableShares } = await this.fetchPrice();
    return {
      pricePerShare: priceInCHF.toString(),
      availableShares,
    };
  }

  async getBrokerbotBuyPrice(shares: number): Promise<BrokerbotBuyPriceDto> {
    const { priceInCHF, availableShares } = await this.fetchPrice();
    const totalPrice = priceInCHF * shares;

    return {
      shares,
      totalPrice: totalPrice.toString(),
      pricePerShare: priceInCHF.toString(),
      availableShares,
    };
  }

  async getBrokerbotShares(amountChf: string): Promise<BrokerbotSharesDto> {
    const { priceInCHF, availableShares } = await this.fetchPrice();
    const shares = Math.floor(parseFloat(amountChf) / priceInCHF);

    return {
      amount: amountChf,
      shares,
      pricePerShare: priceInCHF.toString(),
      availableShares,
    };
  }

  async getBrokerbotInfo(brokerbotAddr: string, realuAddr: string, zchfAddr: string): Promise<BrokerbotInfoDto> {
    const { priceInCHF, availableShares } = await this.fetchPrice();

    return {
      brokerbotAddress: brokerbotAddr,
      tokenAddress: realuAddr,
      baseCurrencyAddress: zchfAddr,
      pricePerShare: priceInCHF.toString(),
      buyingEnabled: availableShares > 0,
      sellingEnabled: true,
      availableShares,
    };
  }

  async getBrokerbotSellPrice(shares: number, slippageBps = 50): Promise<{ zchfAmountWei: bigint }> {
    const { priceInCHF } = await this.fetchPrice();
    const slippageFactor = 1 - slippageBps / 10000;
    const zchfAmount = priceInCHF * shares * slippageFactor;
    const zchfAmountWei = BigInt(Math.floor(zchfAmount * 1e18));
    return { zchfAmountWei };
  }
}
