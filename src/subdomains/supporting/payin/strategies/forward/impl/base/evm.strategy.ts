import { PayInEvmService } from 'src/subdomains/supporting/payin/services/payin-evm.service';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { ForwardStrategy } from './forward.strategy';

export abstract class EvmStrategy extends ForwardStrategy {
  constructor(protected readonly payInEvmService: PayInEvmService, protected readonly payInRepo: PayInRepository) {
    super();
  }
}
