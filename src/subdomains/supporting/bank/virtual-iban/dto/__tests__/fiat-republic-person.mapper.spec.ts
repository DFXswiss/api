import { Country } from 'src/shared/models/country/country.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { FiatRepublicPersonMapper } from '../fiat-republic-person.mapper';

function country(symbol: string): Country {
  return Object.assign(new Country(), { symbol });
}

function userData(overrides: Partial<UserData> = {}): UserData {
  return Object.assign(new UserData(), {
    firstname: 'Synthetic',
    surname: 'Person',
    mail: 'synthetic@example.com',
    birthday: new Date('1990-01-15T00:00:00.000Z'),
    street: 'Bahnhofstrasse',
    houseNumber: '7',
    zip: '6300',
    location: 'Zug',
    country: country('ch'),
    ...overrides,
  });
}

describe('FiatRepublicPersonMapper', () => {
  describe('missingFields', () => {
    it('reports nothing for a complete profile', () => {
      expect(FiatRepublicPersonMapper.missingFields(userData())).toEqual([]);
    });

    it('does not require a house number', () => {
      expect(FiatRepublicPersonMapper.missingFields(userData({ houseNumber: undefined }))).toEqual([]);
    });

    it.each([
      ['firstname', { firstname: undefined }],
      ['surname', { surname: undefined }],
      ['mail', { mail: undefined }],
      ['birthday', { birthday: undefined }],
      ['street', { street: undefined }],
      ['zip', { zip: undefined }],
      ['location', { location: undefined }],
      ['country', { country: undefined }],
    ])('reports %s when it is missing', (field, override) => {
      expect(FiatRepublicPersonMapper.missingFields(userData(override))).toEqual([field]);
    });

    it.each([
      ['firstname', { firstname: '   ' }],
      ['surname', { surname: '' }],
      ['mail', { mail: '  ' }],
      ['street', { street: ' ' }],
      ['zip', { zip: '' }],
      ['location', { location: '   ' }],
    ])('treats a blank %s as missing', (field, override) => {
      expect(FiatRepublicPersonMapper.missingFields(userData(override))).toEqual([field]);
    });

    it('reports a country row without an ISO symbol', () => {
      expect(FiatRepublicPersonMapper.missingFields(userData({ country: country('') }))).toEqual(['country']);
    });

    it('reports every gap at once', () => {
      expect(FiatRepublicPersonMapper.missingFields(userData({ firstname: undefined, zip: undefined }))).toEqual([
        'firstname',
        'zip',
      ]);
    });
  });

  describe('toPerson', () => {
    it('maps the mandatory fields', () => {
      expect(FiatRepublicPersonMapper.toPerson(userData())).toMatchObject({
        firstName: 'Synthetic',
        lastName: 'Person',
        email: 'synthetic@example.com',
        dob: '1990-01-15',
        address: { line1: 'Bahnhofstrasse 7', city: 'Zug', postalCode: '6300', country: 'CH' },
      });
    });

    it('trims padded values', () => {
      const person = FiatRepublicPersonMapper.toPerson(
        userData({ firstname: ' Synthetic ', surname: ' Person ', mail: ' synthetic@example.com ' }),
      );

      expect(person.firstName).toBe('Synthetic');
      expect(person.lastName).toBe('Person');
      expect(person.email).toBe('synthetic@example.com');
    });

    it('leaves out the house number when there is none', () => {
      expect(FiatRepublicPersonMapper.toPerson(userData({ houseNumber: undefined })).address.line1).toBe(
        'Bahnhofstrasse',
      );
    });

    it('omits phone and nationality when they are unknown', () => {
      const person = FiatRepublicPersonMapper.toPerson(userData());

      expect(person).not.toHaveProperty('phone');
      expect(person).not.toHaveProperty('nationality');
    });

    it('includes phone and nationality when they are known', () => {
      const person = FiatRepublicPersonMapper.toPerson(
        userData({ phone: ' +41791234567 ', nationality: country('de') }),
      );

      expect(person.phone).toBe('+41791234567');
      expect(person.nationality).toEqual(['DE']);
    });

    it('omits a blank phone number', () => {
      expect(FiatRepublicPersonMapper.toPerson(userData({ phone: '   ' }))).not.toHaveProperty('phone');
    });

    it('omits a nationality row without an ISO symbol', () => {
      expect(FiatRepublicPersonMapper.toPerson(userData({ nationality: country('') }))).not.toHaveProperty(
        'nationality',
      );
    });

    it('formats the date of birth as a plain ISO date', () => {
      expect(FiatRepublicPersonMapper.toPerson(userData({ birthday: new Date('1975-04-05T22:30:00.000Z') })).dob).toBe(
        '1975-04-05',
      );
    });
  });
});
