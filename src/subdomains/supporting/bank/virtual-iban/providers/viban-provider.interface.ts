import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { VibanAccountHolder } from 'src/subdomains/supporting/bank/virtual-iban/providers/viban-account-holder.enum';

export interface ReservedViban {
  iban: string;
  bban?: string;
  providerAccountRef?: string;
}

/** The provider proved that the create operation had no external side effect. */
export class VibanNotCreatedError extends Error {}

/**
 * Identifies who legally holds the deposit account behind a personal/virtual IBAN. This determines
 * which name/address must be shown to payers as the recipient — a paying bank checks SEPA name<->IBAN
 * match and flags/rejects a mismatch, so showing the wrong holder would defeat the purpose of a
 * "verified" personal IBAN.
 *
 * CUSTOMER: the account is opened in the customer's own name (e.g. Yapeal) — show the customer's own
 * name/address as recipient.
 *
 * DFX: the account is legally held by DFX; the customer only receives a routing IBAN under DFX's own
 * account (e.g. Bank Frick, which has no API support for opening a sub-account in a third party's name —
 * see FrickCreateVirtualIbanRequest.name/address, which the create request never populates) — show
 * DFX's own name/address as recipient, exactly like the standard non-personal bank path.
 */
export interface VibanProvider {
  readonly bankName: IbanBankName;
  readonly currencies: string[];
  readonly accountHolder: VibanAccountHolder;
  isAvailable(): boolean;
  /** Optional non-PII description is provider-specific (Bank Frick uses it for crash recovery). */
  reserveViban(baseAccountIban: string, description?: string): Promise<ReservedViban>;
}
