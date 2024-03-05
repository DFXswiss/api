import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { SpecialExternalIban, SpecialExternalIbanType } from './special-external-iban.entity';
import { SpecialExternalIbanRepository } from './special-external-iban.repository';

@Injectable()
export class SpecialExternalIbanService {
  constructor(private readonly specialExternalIbanRepo: SpecialExternalIbanRepository) {}

  async getMultiAccountIbans(): Promise<SpecialExternalIban[]> {
    return this.specialExternalIbanRepo.findBy({ type: SpecialExternalIbanType.MULTI_ACCOUNT_IBAN });
  }

  async getBlacklist(): Promise<SpecialExternalIban[]> {
    return this.specialExternalIbanRepo.findBy({
      type: In([SpecialExternalIbanType.BANNED_IBAN, SpecialExternalIbanType.BANNED_BIC]),
    });
  }
}
