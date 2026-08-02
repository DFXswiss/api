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

  it('keeps the largest id that survives being parsed', async () => {
    await expect(submit(Number.MAX_SAFE_INTEGER)).resolves.toEqual({
      rejected: [],
      accountId: Number.MAX_SAFE_INTEGER,
    });
  });

  it('accepts a report without an account, which is what an error before sign-in looks like', async () => {
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
    // What 9007199254740993 arrives as once the body is parsed, which is why the range ends here:
    // past the safe integers, two ids that differ can reach the log as the same number.
    ['an id past the safe integer range', Number.MAX_SAFE_INTEGER + 1],
  ])('drops %s and keeps the report', async (_case, value) => {
    await expect(submit(value)).resolves.toEqual({ rejected: [], accountId: undefined });
  });

  // Dropping instead of rejecting only holds if the pipe this app is bootstrapped with applies the
  // transformation at all. Same options as main.ts passes, so a change there that stops it fails
  // here rather than in production.
  it('drops a bad account through the pipe the app runs, instead of answering 400', async () => {
    const pipe = new DetailedValidationPipe({ whitelist: true, transformOptions: { exposeUnsetFields: false } });

    const body = await pipe.transform(
      { message: 'boom', accountId: 'Robert' },
      { type: 'body', metatype: CreateClientErrorDto },
    );

    expect(body).toEqual({ message: 'boom' });
  });
});
