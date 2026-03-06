import { Injectable } from '@nestjs/common';
import { Environment, GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { createPublicClient, http, parseAbi } from 'viem';
import { Blockchain } from '../shared/enums/blockchain.enum';
import { EvmUtil } from '../shared/evm/evm.util';
import {
  BrokerbotBuyPriceDto,
  BrokerbotCurrency,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSharesDto,
} from './dto/realunit-broker.dto';

const BROKERBOT_ABI = parseAbi([
  'function getSellPrice(uint256 shares) view returns (uint256)',
  'function getPrice() view returns (uint256)',
]);

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

  async getBrokerbotPrice(currency: BrokerbotCurrency = BrokerbotCurrency.CHF): Promise<BrokerbotPriceDto> {
    const { priceInCHF, priceInEUR, availableShares } = await this.fetchPrice();
    const price = currency === BrokerbotCurrency.EUR ? priceInEUR : priceInCHF;
    return {
      pricePerShare: price.toString(),
      currency,
      availableShares,
    };
  }

  async getBrokerbotBuyPrice(
    shares: number,
    currency: BrokerbotCurrency = BrokerbotCurrency.CHF,
  ): Promise<BrokerbotBuyPriceDto> {
    const { priceInCHF, priceInEUR, availableShares } = await this.fetchPrice();
    const price = currency === BrokerbotCurrency.EUR ? priceInEUR : priceInCHF;
    const totalPrice = price * shares;

    return {
      shares,
      totalPrice: totalPrice.toString(),
      pricePerShare: price.toString(),
      currency,
      availableShares,
    };
  }

  async getBrokerbotShares(amount: string, currency: BrokerbotCurrency = BrokerbotCurrency.CHF): Promise<BrokerbotSharesDto> {
    const { priceInCHF, priceInEUR, availableShares } = await this.fetchPrice();
    const price = currency === BrokerbotCurrency.EUR ? priceInEUR : priceInCHF;
    const shares = Math.floor(parseFloat(amount) / price);

    return {
      amount,
      shares,
      pricePerShare: price.toString(),
      currency,
      availableShares,
    };
  }

  async getBrokerbotInfo(
    brokerbotAddr: string,
    realuAddr: string,
    zchfAddr: string,
    currency: BrokerbotCurrency = BrokerbotCurrency.CHF,
  ): Promise<BrokerbotInfoDto> {
    const { priceInCHF, priceInEUR, availableShares } = await this.fetchPrice();
    const price = currency === BrokerbotCurrency.EUR ? priceInEUR : priceInCHF;

    return {
      brokerbotAddress: brokerbotAddr,
      tokenAddress: realuAddr,
      baseCurrencyAddress: zchfAddr,
      pricePerShare: price.toString(),
      currency,
      buyingEnabled: availableShares > 0,
      sellingEnabled: true,
      availableShares,
    };
  }

  async getBrokerbotSellPrice(brokerbotAddress: string, shares: number): Promise<{ zchfAmountWei: bigint }> {
    const blockchain = [Environment.DEV, Environment.LOC].includes(GetConfig().environment)
      ? Blockchain.SEPOLIA
      : Blockchain.ETHEREUM;

    const chainConfig = EvmUtil.getViemChainConfig(blockchain);
    if (!chainConfig) {
      throw new Error(`No chain config found for ${blockchain}`);
    }

    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    // Call getSellPrice on the BrokerBot contract
    const zchfAmountWei = (await publicClient.readContract({
      address: brokerbotAddress as `0x${string}`,
      abi: BROKERBOT_ABI,
      functionName: 'getSellPrice',
      args: [BigInt(shares)],
    } as any)) as bigint;

    if (zchfAmountWei === 0n) {
      throw new Error('BrokerBot returned zero sell price');
    }

    return { zchfAmountWei };
  }
}
