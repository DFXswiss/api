import { toPersonalDataMissingFields } from '../personal-data-missing-fields';

describe('toPersonalDataMissingFields', () => {
  it('maps entity names to KycPersonalData request paths', () => {
    expect(
      toPersonalDataMissingFields([
        'firstname',
        'surname',
        'street',
        'location',
        'zip',
        'country',
        'organizationStreet',
        'organizationLocation',
        'organizationZip',
        'organizationCountry',
        'organizationName',
        'phone',
        'accountType',
      ]),
    ).toEqual([
      'firstName',
      'lastName',
      'address.street',
      'address.city',
      'address.zip',
      'address.country',
      'organizationAddress.street',
      'organizationAddress.city',
      'organizationAddress.zip',
      'organizationAddress.country',
      'organizationName',
      'phone',
      'accountType',
    ]);
  });

  it('omits mail because it is not settable on the personal-data endpoint', () => {
    expect(toPersonalDataMissingFields(['mail', 'firstname', 'phone'])).toEqual(['firstName', 'phone']);
  });
});
