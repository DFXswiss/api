/**
 * Maps UserData entity field names to KycPersonalData request paths for submit feedback.
 * `mail` is intentionally omitted: it is not settable on the personal-data endpoint
 * (ContactData step owns it), so reporting it as missing is not actionable for the client.
 */
const PERSONAL_DATA_ENTITY_TO_REQUEST: Readonly<Record<string, string>> = {
  accountType: 'accountType',
  firstname: 'firstName',
  surname: 'lastName',
  phone: 'phone',
  street: 'address.street',
  location: 'address.city',
  zip: 'address.zip',
  country: 'address.country',
  organizationName: 'organizationName',
  organizationStreet: 'organizationAddress.street',
  organizationLocation: 'organizationAddress.city',
  organizationZip: 'organizationAddress.zip',
  organizationCountry: 'organizationAddress.country',
};

export function toPersonalDataMissingFields(entityFields: string[]): string[] {
  return entityFields
    .filter((f) => f !== 'mail')
    .map((f) => PERSONAL_DATA_ENTITY_TO_REQUEST[f])
    .filter((path): path is string => path != null);
}
