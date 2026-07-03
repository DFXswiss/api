import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetSupportIssueFilter } from '../get-support-issue.dto';

// `fromMessageId` reaches Postgres via `MoreThan(...)` against an int4 `support_message.id`
// column. A value > 2^31-1 makes Postgres 500 the whole request with 22003. Pins the DTO-level
// cap so a change to the validator surfaces here rather than at prod runtime.
describe('GetSupportIssueFilter.fromMessageId int4 cap', () => {
  const validateFilter = async (raw: Record<string, unknown>) => {
    const instance = plainToInstance(GetSupportIssueFilter, raw);
    return validate(instance);
  };

  it('accepts a small positive value', async () => {
    const errors = await validateFilter({ fromMessageId: 42 });
    expect(errors).toEqual([]);
  });

  it('accepts exactly int4 max (2147483647)', async () => {
    const errors = await validateFilter({ fromMessageId: 2147483647 });
    expect(errors).toEqual([]);
  });

  it('rejects one above int4 max (2147483648)', async () => {
    const errors = await validateFilter({ fromMessageId: 2147483648 });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('max');
  });

  it('rejects a very large numeric string (pasted phone number)', async () => {
    const errors = await validateFilter({ fromMessageId: '41791234567' });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('max');
  });

  it('rejects a negative value', async () => {
    const errors = await validateFilter({ fromMessageId: -1 });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('accepts an omitted value', async () => {
    const errors = await validateFilter({});
    expect(errors).toEqual([]);
  });
});
