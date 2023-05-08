import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayInFactory } from 'src/subdomains/supporting/payin/factories/payin.factory';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { RegisterStrategy } from './register.strategy';

export abstract class JellyfishStrategy extends RegisterStrategy {
  constructor(
    protected readonly dexService: DexService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
  ) {
    super(dexService, payInFactory, payInRepository);
  }
}
