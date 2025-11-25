import { Injectable } from '@nestjs/common';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { ExchangeService } from './exchange.service';

export interface BalanceProvider {
  name: string;
  getTotalBalances(): Promise<Record<string, number>>;
  getAvailableBalance(currency: string): Promise<number>;
}

@Injectable()
export class ExchangeRegistryService extends StrategyRegistry<string, ExchangeService> {
  private readonly balanceProviders: Map<string, BalanceProvider> = new Map();

  protected getKey(key: string): string {
    return key.toLowerCase();
  }

  addBalanceProvider(key: string, provider: BalanceProvider): void {
    this.balanceProviders.set(this.getKey(key), provider);
  }

  getBalanceProvider(key: string): BalanceProvider | ExchangeService {
    return this.balanceProviders.get(this.getKey(key)) ?? this.get(key);
  }
}
