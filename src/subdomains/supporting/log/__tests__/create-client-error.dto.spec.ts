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

  it.each([
    ['free text', 'Robert'],
    // The pipe runs without implicit conversion, so a client that sends the id as text is rejected
    // rather than silently accepted - and a rejected report is a report nobody sees.
    ['the id as a string', '123456'],
    ['a fraction', 1.5],
    ['a boolean', true],
  ])('rejects %s', async (_case, value) => {
    await expect(errorsFor(value)).resolves.toEqual(['accountId']);
  });
});
