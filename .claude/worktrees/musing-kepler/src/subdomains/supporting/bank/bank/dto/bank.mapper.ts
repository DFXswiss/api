import { Bank } from '../bank.entity';
import { BankDto } from './bank.dto';

export class BankMapper {
  static toDto(bank: Bank): BankDto {
    const dto: BankDto = {
      name: bank.name,
      iban: bank.iban,
      bic: bank.bic,
      currency: bank.currency,
    };

    return Object.assign(new BankDto(), dto);
  }
}
