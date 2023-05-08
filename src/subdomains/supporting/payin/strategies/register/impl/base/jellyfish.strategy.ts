import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayInFactory } from 'src/subdomains/supporting/payin/factories/payin.factory';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { RegisterStrategy } from './register.strategy';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export abstract class JellyfishStrategy extends RegisterStrategy {
  constructor(
    protected readonly dexService: DexService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
    readonly logger: DfxLogger,
  ) {
    super(dexService, payInFactory, payInRepository, logger);
  }
}
