import { Fiat } from 'src/shared/models/fiat/fiat.entity';

export class BankAccountDto {
  iban: string;
  preferredCurrency: Fiat;
  label: string;
  sepaInstant: boolean;
}
