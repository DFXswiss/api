import { Injectable } from '@nestjs/common';
import { SpecialExternalIban, SpecialExternalIbanType } from './special-external-iban.entity';
import { SpecialExternalIbanRepository } from './special-external-iban.repository';

@Injectable()
export class SpecialExternalIbanService {
  constructor(private readonly specialExternalIbanRepo: SpecialExternalIbanRepository) {}

  async getMultiAccountIban(): Promise<SpecialExternalIban[]> {
    return this.specialExternalIbanRepo.findBy({ type: SpecialExternalIbanType.MULTI_ACCOUNT_IBAN });
  }

  async getBlacklist(): Promise<SpecialExternalIban[]> {
    return this.specialExternalIbanRepo.findBy([
      { type: SpecialExternalIbanType.BANNED_IBAN },
      { type: SpecialExternalIbanType.BANNED_BIC },
    ]);
  }
}
