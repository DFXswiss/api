import { PayInFactory } from 'src/subdomains/supporting/payin/factories/payin.factory';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInStrategy } from './payin.strategy';

export abstract class JellyfishStrategy extends PayInStrategy {
  constructor(protected readonly payInFactory: PayInFactory, protected readonly payInRepository: PayInRepository) {
    super(payInFactory, payInRepository);
  }
}
