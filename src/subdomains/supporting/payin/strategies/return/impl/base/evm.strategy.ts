import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { ReturnStrategy } from './return.strategy';

export abstract class EvmStrategy extends ReturnStrategy {
  constructor(protected readonly payInEvmService: PayInEvmService, protected readonly payInRepo: PayInRepository) {
    super();
  }
}
