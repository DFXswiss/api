import { Injectable } from '@nestjs/common';
import { MultiAccountIban } from './multi-account-iban.entity';
import { MultiAccountIbanRepository } from './multi-account-iban.repository';

@Injectable()
export class MultiAccountIbanService {
  constructor(private readonly multiAccountIbanRepo: MultiAccountIbanRepository) {}

  async getAllMultiAccountIban(): Promise<MultiAccountIban[]> {
    return this.multiAccountIbanRepo.find();
  }
}
