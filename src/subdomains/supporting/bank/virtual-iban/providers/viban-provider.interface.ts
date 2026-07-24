import { IbanBankName } from '../../bank/dto/bank.dto';

export interface ReservedViban {
  iban: string;
  bban?: string;
  providerAccountRef?: string;
}

/** The provider proved that the create operation had no external side effect. */
export class VibanNotCreatedError extends Error {}

export interface VibanProvider {
  readonly bankName: IbanBankName;
  readonly currencies: string[];
  isAvailable(): boolean;
  /** Optional non-PII description is provider-specific (Bank Frick uses it for crash recovery). */
  reserveViban(baseAccountIban: string, description?: string): Promise<ReservedViban>;
}
