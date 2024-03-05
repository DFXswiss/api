import { Injectable } from '@nestjs/common';
import { SpecialExternalIban, SpecialExternalIbanType } from './special-external-iban.entity';
import { SpecialExternalIbanRepository } from './special-external-iban.repository';

@Injectable()
export class SpecialExternalIbanService {
  constructor(private readonly specialExternalIbanRepo: SpecialExternalIbanRepository) {}

  async getAllSpecialExternalIban(type: SpecialExternalIbanType): Promise<SpecialExternalIban[]> {
    return this.specialExternalIbanRepo.findBy({ type });
  }

  async getAllBlacklist(): Promise<SpecialExternalIban[]> {
    return this.specialExternalIbanRepo.findBy([
      { type: SpecialExternalIbanType.IBAN_BLACKLIST },
      { type: SpecialExternalIbanType.BIC_BLACKLIST },
    ]);
  }
}
