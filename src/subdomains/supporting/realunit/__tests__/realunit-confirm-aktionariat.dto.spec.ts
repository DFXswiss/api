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
