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
  /** Optional non-PII description is provider-specific (Bank Frick uses it for crash recovery). */
  reserveViban(baseAccountIban: string, description?: string): Promise<ReservedViban>;
}
