import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { RegisterStrategy } from './register.strategy';

export abstract class JellyfishStrategy extends RegisterStrategy {
  constructor(payInRepository: PayInRepository) {
    super(payInRepository);
  }
}
