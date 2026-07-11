import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  RealUnitConfirmAktionariatEventDto,
  RealUnitConfirmAktionariatEventPhase,
  RealUnitConfirmAktionariatQueryDto,
} from '../dto/realunit-confirm-aktionariat.dto';

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

describe('RealUnitConfirmAktionariatEventDto', () => {
  const build = (raw: Record<string, unknown>) => plainToInstance(RealUnitConfirmAktionariatEventDto, raw);

  it('accepts a whitelisted phase with only the required field', async () => {
    const errors = await validate(build({ phase: RealUnitConfirmAktionariatEventPhase.PAGE_LOADED }));
    expect(errors).toEqual([]);
  });

  it('accepts a whitelisted phase with all optional fields', async () => {
    const errors = await validate(
      build({
        phase: RealUnitConfirmAktionariatEventPhase.REQUEST_ERROR,
        email: 'user@example.com',
        code: 'CONFIRM-CODE',
        user: 'aktionariat-user-1',
        detail: 'network timeout',
      }),
    );
    expect(errors).toEqual([]);
  });

  it('rejects a phase outside the whitelist', async () => {
    const errors = await validate(build({ phase: 'somethingElse' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isEnum');
  });

  it('rejects a missing phase', async () => {
    const errors = await validate(build({ email: 'user@example.com' }));
    expect(errors.some((e) => e.property === 'phase')).toBe(true);
  });

  it('rejects a detail longer than 500 characters', async () => {
    const errors = await validate(
      build({ phase: RealUnitConfirmAktionariatEventPhase.REQUEST_ERROR, detail: 'x'.repeat(501) }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('rejects an email longer than 256 characters', async () => {
    const errors = await validate(
      build({ phase: RealUnitConfirmAktionariatEventPhase.PAGE_LOADED, email: `${'a'.repeat(250)}@example.com` }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });
});
