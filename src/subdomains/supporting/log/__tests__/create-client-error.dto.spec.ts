import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DetailedValidationPipe } from 'src/shared/pipes/detailed-validation.pipe';
import { CreateClientErrorDto } from '../dto/create-client-error.dto';

// The account is the one field on this DTO that is read back as a number rather than as text, and
// the only one whose value may be discarded without the report going with it. Both are pinned here
// because the endpoint is unauthenticated: whatever shape arrives is a shape anyone can post, and
// the field exists to be looked up in the logs, not to carry prose.
describe('CreateClientErrorDto.accountId', () => {
  async function submit(accountId: unknown): Promise<{ rejected: string[]; accountId?: number }> {
    const dto = plainToInstance(CreateClientErrorDto, { message: 'boom', accountId });
    const errors = await validate(dto);

    return { rejected: errors.map((e) => e.property), accountId: dto.accountId };
  }

  it('keeps an account id', async () => {
    await expect(submit(123456)).resolves.toEqual({ rejected: [], accountId: 123456 });
  });

  it('keeps the largest safe account id', async () => {
    await expect(submit(Number.MAX_SAFE_INTEGER)).resolves.toEqual({
      rejected: [],
      accountId: Number.MAX_SAFE_INTEGER,
    });
  });

  // The limit is on what arrives, not on what was written: the body is parsed before any of this
  // runs, and a fractional value near the limit arrives as an integer. Recorded as parsed - pinned
  // so the guarantee is not read as wider than it is.
  it('keeps what the parser made of a value written with a fraction', async () => {
    await expect(submit(JSON.parse('9007199254740991.1'))).resolves.toEqual({
      rejected: [],
      accountId: Number.MAX_SAFE_INTEGER,
    });
  });

  it('accepts a report that carries no account at all', async () => {
    const errors = await validate(plainToInstance(CreateClientErrorDto, { message: 'boom' }));

    expect(errors).toEqual([]);
  });

  // Everything below is dropped rather than rejected. A 400 would take message, stack and route
  // with it, and those are what the report exists for.
  it.each([
    ['free text', 'Robert'],
    // The pipe runs without implicit conversion, so an id sent as text is not silently read as one.
    ['the id as a string', '123456'],
    ['a fraction', 1.5],
    ['a boolean', true],
    ['null', null],
    ['zero, which is no account', 0],
    ['a negative id', -1],
    // What 9007199254740993 arrives as once the body is parsed. Dropping it is the point: without
    // the bound, ids that differ would be recorded under the same number.
    ['an id past the safe integer range', Number.MAX_SAFE_INTEGER + 1],
  ])('drops %s and keeps the report', async (_case, value) => {
    await expect(submit(value)).resolves.toEqual({ rejected: [], accountId: undefined });
  });

  // What the field does under the pipe the app is actually bootstrapped with - same options as
  // main.ts passes. Two things only hold there: `whitelist: true` strips a property the DTO does
  // not declare, so an account that is declared but loses its decorators would silently stop being
  // recorded; and the transformation is what drops a bad value instead of rejecting the report.
  describe('under the pipe the app runs', () => {
    const pipe = new DetailedValidationPipe({ whitelist: true, transformOptions: { exposeUnsetFields: false } });

    function submitTo(accountId: unknown): Promise<unknown> {
      return pipe.transform({ message: 'boom', accountId }, { type: 'body', metatype: CreateClientErrorDto });
    }

    it('records the account rather than stripping it', async () => {
      await expect(submitTo(123456)).resolves.toEqual({ message: 'boom', accountId: 123456 });
    });

    it('drops a bad account instead of answering 400', async () => {
      await expect(submitTo('Robert')).resolves.toEqual({ message: 'boom' });
    });
  });
});
