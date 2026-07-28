import { DfxLogger } from 'src/shared/services/dfx-logger';
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

  it('omits mail as a known non-reportable field without treating it as unknown', () => {
    const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

    expect(toPersonalDataMissingFields(['mail', 'firstname', 'phone'])).toEqual(['firstName', 'phone']);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('logs unknown entity fields instead of silently dropping them', () => {
    const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

    expect(toPersonalDataMissingFields(['notARealField', 'phone'])).toEqual(['phone']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('notARealField'));

    errorSpy.mockRestore();
  });
});
