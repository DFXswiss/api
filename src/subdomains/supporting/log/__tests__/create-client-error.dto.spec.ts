import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateClientErrorDto } from '../dto/create-client-error.dto';

// The account is the one field on this DTO that is read back as a number rather than as text. It is
// pinned here because the endpoint is unauthenticated: whatever shape is accepted is a shape anyone
// can post, and the field exists to be looked up in the logs, not to carry prose.
describe('CreateClientErrorDto.accountId', () => {
  async function errorsFor(accountId: unknown): Promise<string[]> {
    const errors = await validate(plainToInstance(CreateClientErrorDto, { message: 'boom', accountId }));

    return errors.map((e) => e.property);
  }

  it('accepts an account id', async () => {
    await expect(errorsFor(123456)).resolves.toEqual([]);
  });

  it('accepts a report without an account, which is what an error before sign-in looks like', async () => {
    const errors = await validate(plainToInstance(CreateClientErrorDto, { message: 'boom' }));

    expect(errors).toEqual([]);
  });

  // A client that fills the field with null rather than leaving it out sends a report worth
  // keeping, and `@IsOptional()` treats it as absent - the log then carries an empty account.
  it('accepts null as an absent account', async () => {
    await expect(errorsFor(null)).resolves.toEqual([]);
  });

  it('accepts the largest id that survives being parsed', async () => {
    await expect(errorsFor(Number.MAX_SAFE_INTEGER)).resolves.toEqual([]);
  });

  it.each([
    ['free text', 'Robert'],
    // The pipe runs without implicit conversion, so a client that sends the id as text is rejected
    // rather than silently accepted - and a rejected report is a report nobody sees.
    ['the id as a string', '123456'],
    ['a fraction', 1.5],
    ['a boolean', true],
    ['zero, which is no account', 0],
    ['a negative id', -1],
    // What an id beyond the safe range arrives as: the parser rounds 9007199254740993 to this,
    // so two different ids sent would otherwise be logged as the same one.
    ['an id past the safe integer range', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects %s', async (_case, value) => {
    await expect(errorsFor(value)).resolves.toEqual(['accountId']);
  });
});
