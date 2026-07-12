import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RealUnitConfirmAktionariatQueryDto } from '../dto/realunit-confirm-aktionariat.dto';

describe('RealUnitConfirmAktionariatQueryDto.email (case-robust)', () => {
  const build = (raw: Record<string, unknown>) => plainToInstance(RealUnitConfirmAktionariatQueryDto, raw);
  const baseline = { code: 'CONFIRM-CODE', user: 'aktionariat-user-1' };

  it('normalises a mixed-/upper-case email to trimmed lowercase and accepts it', async () => {
    const dto = build({ ...baseline, email: '  USER@Example.COM  ' });
    expect(dto.email).toBe('user@example.com');
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts an already-lowercase email unchanged', async () => {
    const dto = build({ ...baseline, email: 'user@example.com' });
    expect(dto.email).toBe('user@example.com');
    expect(await validate(dto)).toEqual([]);
  });

  it('still rejects a value that is not an email after normalisation', async () => {
    const errors = await validate(build({ ...baseline, email: 'not-an-email' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isEmail');
  });
});

describe('RealUnitConfirmAktionariatQueryDto under the global ValidationPipe (unknown-param tolerance)', () => {
  // Mirror the production global pipe (src/main.ts): whitelist strips unknown props but, without
  // forbidNonWhitelisted, must NOT reject them — so an Aktionariat mail link carrying an extra param never 400s.
  const pipe = new ValidationPipe({ whitelist: true, transformOptions: { exposeUnsetFields: false } });
  const metadata: ArgumentMetadata = { type: 'query', metatype: RealUnitConfirmAktionariatQueryDto, data: '' };

  it('accepts extra unknown query params without a 400 and strips them from the typed DTO', async () => {
    const dto = await pipe.transform(
      { email: '  USER@Example.COM  ', code: 'CONFIRM-CODE', user: 'aktionariat-user-1', address: '0xABC', foo: 'bar' },
      metadata,
    );

    // The three modelled params survive, normalised as before.
    expect(dto.email).toBe('user@example.com');
    expect(dto.code).toBe('CONFIRM-CODE');
    expect(dto.user).toBe('aktionariat-user-1');
    // The unknown params are stripped from the DTO (hence the confirm route must capture them from the raw
    // request instead), but their presence never fails validation.
    expect((dto as Record<string, unknown>).address).toBeUndefined();
    expect((dto as Record<string, unknown>).foo).toBeUndefined();
  });
});
