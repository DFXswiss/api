import { Bank } from '../bank.entity';
import { BankDto } from './bank.dto';

export class BankDtoMapper {
  static entityToDto(bank: Bank): BankDto {
    const dto: BankDto = {
        id: bank.id,
        name: bank.name,
        iban: bank.iban,
        bic: bank.bic,
        currency: bank.currency,
        receive: bank.receive,
        send: bank.send,
        sctInst: bank.sctInst
    };

    return Object.assign(new BankDto(), dto);
  }

  static entitiesToDto(banks: Bank[]): BankDto[] {
    const dto: BankDto[] = [];
    for (const bank of banks) {
      dto.push(this.entityToDto(bank));
    }
    return dto;
  }
}
