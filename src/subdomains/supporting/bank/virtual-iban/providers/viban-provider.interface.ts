import { IbanBankName } from '../../bank/dto/bank.dto';

export interface ReservedViban {
  iban: string;
  bban?: string;
  providerAccountRef?: string;
}

export interface VibanProvider {
  readonly bankName: IbanBankName;
  readonly currencies: string[];
  isAvailable(): boolean;
  reserveViban(baseAccountIban: string): Promise<ReservedViban>;
}
