import { Fiat } from 'src/shared/models/fiat/fiat.entity';

export class BankAccountDto {
  id: number;
  iban: string;
  preferredCurrency: Fiat;
  label: string;
  sepaInstant: boolean;
}
