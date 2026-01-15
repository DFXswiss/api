import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { ExchangeName } from '../enums/exchange.enum';
import { ExchangeService } from './exchange.service';
import { ScryptService } from './scrypt.service';

@Injectable()
export class ExchangeRegistryService extends StrategyRegistry<string, ExchangeService> {
  @Inject(forwardRef(() => ScryptService))
  private readonly scryptService: ScryptService;

  protected getKey(key: string): string {
    return key.toLowerCase();
  }

  getExchange(exchange: string): ExchangeService | ScryptService {
    return exchange === ExchangeName.SCRYPT ? this.scryptService : this.get(exchange);
  }
}
