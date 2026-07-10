import { getMetadataArgsStorage } from 'typeorm';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { AktionariatRegistrationDto, RealUnitLanguage, RealUnitUserType } from '../dto/realunit-registration.dto';
import { AktionariatRegistration } from '../entities/aktionariat-registration.entity';

describe('AktionariatRegistration', () => {
  const samplePayload = (): AktionariatRegistrationDto => ({
    email: 'erika.example@example.com',
    name: 'Erika Müller',
    type: RealUnitUserType.HUMAN,
    phoneNumber: '+41790000000',
    birthday: '1990-01-01',
    nationality: 'CH',
    addressStreet: 'Bahnhofstrasse 1',
    addressPostalCode: '8001',
    addressCity: 'Zürich',
    addressCountry: 'CH',
    swissTaxResidence: true,
    registrationDate: '2026-06-08',
    walletAddress: '0x1234567890123456789012345678901234567890',
    signature: '0xsignature',
    lang: RealUnitLanguage.DE,
  });

  it('serialises signedPayloadData to a JSON string via the setter', () => {
    const entity = new AktionariatRegistration();
    entity.signedPayloadData = samplePayload();
    expect(entity.signedPayload).toBe(JSON.stringify(samplePayload()));
  });

  it('parses signedPayloadData from the JSON string via the getter', () => {
    const entity = new AktionariatRegistration();
    entity.signedPayload = JSON.stringify(samplePayload());
    expect(entity.signedPayloadData).toEqual(samplePayload());
  });

  it('round-trips a full payload through setter and getter', () => {
    const entity = new AktionariatRegistration();
    const payload = samplePayload();
    entity.signedPayloadData = payload;
    expect(entity.signedPayloadData).toEqual(payload);
  });

  it('returns undefined from the getter when no payload is stored', () => {
    const entity = new AktionariatRegistration();
    expect(entity.signedPayloadData).toBeUndefined();
  });

  it('clears the signedPayload column when the setter receives null', () => {
    const entity = new AktionariatRegistration();
    entity.signedPayload = '{"a":1}';
    entity.signedPayloadData = null;
    expect(entity.signedPayload).toBeNull();
  });

  it('clears the signedPayload column when the setter receives undefined', () => {
    const entity = new AktionariatRegistration();
    entity.signedPayload = '{"a":1}';
    entity.signedPayloadData = undefined;
    expect(entity.signedPayload).toBeNull();
  });

  it('declares a required ManyToOne relation to User (one FK per wallet)', () => {
    const relation = getMetadataArgsStorage().relations.find(
      (r) => r.target === AktionariatRegistration && r.propertyName === 'user',
    );
    expect(relation).toBeDefined();
    expect(relation!.relationType).toBe('many-to-one');
    expect((relation!.type as () => unknown)()).toBe(User);
    expect(relation!.options.nullable).toBe(false);
  });

  it('enforces a single active registration per user via a partial unique index', () => {
    const index = getMetadataArgsStorage().indices.find(
      (i) => i.target === AktionariatRegistration && typeof i.columns === 'function',
    );
    expect(index).toBeDefined();
    expect(index!.unique).toBe(true);
    expect(index!.where).toBe('"active" = true');
    const columns = (index!.columns as (r: any) => unknown[])({ user: 'USER_COLUMN' });
    expect(columns).toEqual(['USER_COLUMN']);
  });
});
