import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfigService } from 'src/config/config';
import { KycPersonalData } from 'src/subdomains/generic/kyc/dto/input/kyc-data.dto';
import { RealUnitRegistrationDto } from '../dto/realunit-registration.dto';

// Validation-decorator coverage for the conditional countryAndTINs rules and the nested kycData factory.
// Uses only synthetic data. Assertions filter by field so unrelated (phone/address) validators cannot
// mask the specific branch under test.
describe('RealUnitRegistrationDto (class-validator decorators)', () => {
  // Populate the global `Config` singleton so the IsSwissPaymentText validator (Config.formats) resolves.
  beforeAll(() => {
    new ConfigService();
  });

  const baseline = (): Record<string, unknown> => ({
    email: 'user@example.com',
    name: 'Erika Mueller',
    type: 'HUMAN',
    phoneNumber: '+41791234567',
    birthday: '1990-01-01',
    nationality: 'CH',
    addressStreet: 'Bahnhofstrasse 1',
    addressPostalCode: '8001',
    addressCity: 'Zurich',
    addressCountry: 'CH',
    swissTaxResidence: true,
    registrationDate: '2026-01-01',
    walletAddress: `0x${'a'.repeat(40)}`,
    signature: `0x${'b'.repeat(130)}`,
    lang: 'DE',
    kycData: {
      accountType: 'Personal',
      firstName: 'Erika',
      lastName: 'Mueller',
      phone: '+41791234567',
      address: { street: 'Bahnhofstrasse', houseNumber: '1', city: 'Zurich', zip: '8001', country: { id: 1 } },
    },
  });

  const build = (overrides: Record<string, unknown>): RealUnitRegistrationDto =>
    plainToInstance(RealUnitRegistrationDto, { ...baseline(), ...overrides });

  // --- countryAndTINs conditional validation (@ValidateIf(!swissTaxResidence)) --- //

  it('requires countryAndTINs when swissTaxResidence is false (missing → IsNotEmpty)', async () => {
    const errors = await validate(build({ swissTaxResidence: false, countryAndTINs: undefined }));
    const tinError = errors.find((e) => e.property === 'countryAndTINs');
    expect(tinError).toBeDefined();
    expect(tinError!.constraints).toHaveProperty('isNotEmpty');
  });

  it('accepts a valid countryAndTINs array when swissTaxResidence is false', async () => {
    const errors = await validate(
      build({ swissTaxResidence: false, countryAndTINs: [{ country: 'DE', tin: '12345' }] }),
    );
    expect(errors.find((e) => e.property === 'countryAndTINs')).toBeUndefined();
  });

  it('validates the nested CountryAndTin entries (bad country code + empty tin) via the @Type factory', async () => {
    const errors = await validate(
      build({ swissTaxResidence: false, countryAndTINs: [{ country: 'invalid', tin: '' }] }),
    );
    const tinError = errors.find((e) => e.property === 'countryAndTINs');
    expect(tinError).toBeDefined();
    expect(tinError!.children?.length).toBeGreaterThan(0);
  });

  it('skips countryAndTINs validation when swissTaxResidence is true (ValidateIf false branch)', async () => {
    const errors = await validate(build({ swissTaxResidence: true, countryAndTINs: undefined }));
    expect(errors.find((e) => e.property === 'countryAndTINs')).toBeUndefined();
  });

  // When swissTaxResidence is true BUT countryAndTINs is present, validators must still run
  // (previously @ValidateIf skipped @IsArray and a non-array body reached the service as a 500).
  it('rejects a non-array countryAndTINs when swissTaxResidence is true (F3 regression)', async () => {
    const errors = await validate(build({ swissTaxResidence: true, countryAndTINs: 'pwned' }));
    const tinError = errors.find((e) => e.property === 'countryAndTINs');
    expect(tinError).toBeDefined();
    expect(tinError!.constraints).toHaveProperty('isArray');
  });

  it('rejects a TIN longer than 64 characters via @MaxLength', async () => {
    const errors = await validate(
      build({ swissTaxResidence: true, countryAndTINs: [{ country: 'DE', tin: 'x'.repeat(65) }] }),
    );
    const tinError = errors.find((e) => e.property === 'countryAndTINs');
    expect(tinError).toBeDefined();
    expect(tinError!.children?.length).toBeGreaterThan(0);
    const nestedTinError = tinError!.children![0].children?.find((e) => e.property === 'tin');
    expect(nestedTinError?.constraints).toHaveProperty('maxLength');
  });

  it('rejects more than 10 countryAndTINs entries via @ArrayMaxSize', async () => {
    // Valid 2-letter codes so only ArrayMaxSize (not nested Matches) is the failure mode.
    const countries = ['DE', 'FR', 'US', 'AT', 'IT', 'ES', 'NL', 'BE', 'PT', 'IE', 'PL'];
    const countryAndTINs = countries.map((country, i) => ({ country, tin: `TIN${i}` }));
    const errors = await validate(build({ swissTaxResidence: false, countryAndTINs }));
    const tinError = errors.find((e) => e.property === 'countryAndTINs');
    expect(tinError).toBeDefined();
    expect(tinError!.constraints).toHaveProperty('arrayMaxSize');
  });

  it('trims TIN whitespace via string-safe @Transform', () => {
    const dto = build({ swissTaxResidence: false, countryAndTINs: [{ country: 'DE', tin: '  DE123  ' }] });
    expect(dto.countryAndTINs![0].tin).toBe('DE123');
  });

  // Non-string tin must not crash @Transform (Util.trim would throw TypeError => HTTP 500);
  // the value must fall through so @IsString can reject it as a clean 400.
  it('rejects a non-string tin as isString without throwing (400 not 500 regression)', async () => {
    const errors = await validate(build({ swissTaxResidence: true, countryAndTINs: [{ country: 'DE', tin: 12345 }] }));
    const tinError = errors.find((e) => e.property === 'countryAndTINs');
    expect(tinError).toBeDefined();
    expect(tinError!.children?.length).toBeGreaterThan(0);
    const nestedTinError = tinError!.children![0].children?.find((e) => e.property === 'tin');
    expect(nestedTinError?.constraints).toHaveProperty('isString');
  });

  it('accepts exactly 10 countryAndTINs entries (ArrayMaxSize boundary)', async () => {
    const countries = ['DE', 'FR', 'US', 'AT', 'IT', 'ES', 'NL', 'BE', 'PT', 'IE'];
    const countryAndTINs = countries.map((country, i) => ({ country, tin: `TIN${i}` }));
    const errors = await validate(build({ swissTaxResidence: false, countryAndTINs }));
    expect(errors.find((e) => e.property === 'countryAndTINs')).toBeUndefined();
  });

  // --- kycData nested factory (@Type(() => KycPersonalData)) --- //

  it('instantiates kycData through the KycPersonalData type factory', () => {
    const dto = build({});
    expect(dto.kycData).toBeInstanceOf(KycPersonalData);
  });

  it('flags an invalid nested kycData (missing required fields) via @ValidateNested', async () => {
    const errors = await validate(build({ kycData: { firstName: 'Erika' } }));
    const kycError = errors.find((e) => e.property === 'kycData');
    expect(kycError).toBeDefined();
    expect(kycError!.children?.length).toBeGreaterThan(0);
  });
});
