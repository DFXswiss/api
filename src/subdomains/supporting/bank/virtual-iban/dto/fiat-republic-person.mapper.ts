import { FiatRepublicPerson } from 'src/integration/bank/dto/fiat-republic.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';

/**
 * Fields Fiat Republic requires on an individual end user. Listed explicitly so a customer with an
 * incomplete profile is rejected before any data leaves DFX, with a message naming what is missing —
 * rather than by an opaque upstream validation error that echoes the payload back.
 */
export type MissingPersonField =
  | 'firstname'
  | 'surname'
  | 'mail'
  | 'birthday'
  | 'street'
  | 'zip'
  | 'location'
  | 'country';

export class FiatRepublicPersonMapper {
  static missingFields(userData: UserData): MissingPersonField[] {
    const missing: MissingPersonField[] = [];

    if (!userData.firstname?.trim()) missing.push('firstname');
    if (!userData.surname?.trim()) missing.push('surname');
    if (!userData.mail?.trim()) missing.push('mail');
    if (!userData.birthday) missing.push('birthday');
    if (!userData.street?.trim()) missing.push('street');
    if (!userData.zip?.trim()) missing.push('zip');
    if (!userData.location?.trim()) missing.push('location');
    if (!userData.country?.symbol) missing.push('country');

    return missing;
  }

  static toPerson(userData: UserData): FiatRepublicPerson {
    return {
      firstName: userData.firstname.trim(),
      lastName: userData.surname.trim(),
      email: userData.mail.trim(),
      dob: this.toIsoDate(userData.birthday),
      address: {
        line1: [userData.street.trim(), userData.houseNumber?.trim()].filter(Boolean).join(' '),
        city: userData.location.trim(),
        postalCode: userData.zip.trim(),
        country: userData.country.symbol.toUpperCase(),
      },
      ...(userData.phone?.trim() && { phone: userData.phone.trim() }),
      ...(userData.nationality?.symbol && { nationality: [userData.nationality.symbol.toUpperCase()] }),
    };
  }

  /** Fiat Republic expects `YYYY-MM-DD`; the stored value is a timestamp. */
  private static toIsoDate(date: Date): string {
    return new Date(date).toISOString().split('T')[0];
  }
}
