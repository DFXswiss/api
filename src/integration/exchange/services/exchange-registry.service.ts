import { Injectable } from '@nestjs/common';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { ExchangeService } from './exchange.service';

@Injectable()
export class ExchangeRegistryService extends StrategyRegistry<string, ExchangeService> {
  protected getKey(key: string): string {
    return key.toLowerCase();
  }
}
