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

// Contract addresses
const BROKERBOT_ADDRESS = '0xCFF32C60B87296B8c0c12980De685bEd6Cb9dD6d';
const REALU_TOKEN_ADDRESS = '0x553C7f9C780316FC1D34b8e14ac2465Ab22a090B';
const ZCHF_ADDRESS = '0xb58e61c3098d85632df34eecfb899a1ed80921cb';

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
  [key: string]: unknown;
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

  async getRealUnitPrice(): Promise<number> {
    const { priceInCHF } = await this.fetchPrice();
    return priceInCHF;
  }

  async getRealUnitPriceEur(): Promise<number> {
    const { priceInEUR } = await this.fetchPrice();
    return priceInEUR;
  }

  async requestPaymentInstructions(request: PaymentInstructionsRequest): Promise<PaymentInstructionsResponse> {
    const { url, key } = GetConfig().blockchain.realunit.api;
    return this.http.post(`${url}/directinvestment/requestPaymentInstructions`, request, {
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

  async getBrokerbotInfo(): Promise<BrokerbotInfoDto> {
    const { priceInCHF, availableShares } = await this.fetchPrice();

    return {
      brokerbotAddress: BROKERBOT_ADDRESS,
      tokenAddress: REALU_TOKEN_ADDRESS,
      baseCurrencyAddress: ZCHF_ADDRESS,
      pricePerShare: priceInCHF.toString(),
      buyingEnabled: availableShares > 0,
      sellingEnabled: true,
      availableShares,
    };
  }
}
