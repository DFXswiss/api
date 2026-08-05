import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MaxDbId, SyncLegacyFilesQueryDto } from '../kyc-legacy-file.dto';

// The query decides how much the sync touches, so a value that is not an account id must fail the
// request: falling back to "no restriction" would turn a single-account run into a run over every one.
describe('SyncLegacyFilesQueryDto', () => {
  function validate(query: Record<string, string>): { errors: string[]; dto: SyncLegacyFilesQueryDto } {
    const dto = plainToInstance(SyncLegacyFilesQueryDto, query);
    return { errors: validateSync(dto).map((e) => e.property), dto };
  }

  it('accepts an account id and passes it on as a number', () => {
    const { errors, dto } = validate({ userDataId: '185580' });

    expect(errors).toEqual([]);
    expect(dto.userDataId).toBe(185580);
  });

  it('accepts a run without restriction', () => {
    const { errors, dto } = validate({});

    expect(errors).toEqual([]);
    expect(dto.userDataId).toBeUndefined();
  });

  it.each(['185580x', '', 'all', '18.5', '0', '-1', `${MaxDbId + 1}`])(
    'rejects %p instead of falling back to a run over every account',
    (userDataId) => {
      expect(validate({ userDataId }).errors).toEqual(['userDataId']);
    },
  );

  it('keeps dryRun a string, so only the exact opt-out reaches the write path', () => {
    const { errors, dto } = validate({ dryRun: 'false' });

    expect(errors).toEqual([]);
    expect(dto.dryRun).toBe('false');
    expect(dto.dryRun !== 'false').toBe(false);
  });

  it.each(['true', 'False', 'no', ''])('treats %p as a dry run', (dryRun) => {
    const { errors, dto } = validate({ dryRun });

    expect(errors).toEqual([]);
    expect(dto.dryRun !== 'false').toBe(true);
  });
});
