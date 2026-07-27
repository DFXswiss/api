import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResolveUncertainOrderDto } from '../resolve-uncertain-order.dto';

// This DTO carries the record of a decision to release an order whose outcome the venue could not confirm:
// an assertion that somebody checked, and where. Both are read later by whoever has to reconstruct why the
// release was allowed, so the input has to survive transformation as written.
describe('ResolveUncertainOrderDto', () => {
  const validateDto = async (raw: Record<string, unknown>) => validate(plainToInstance(ResolveUncertainOrderDto, raw));

  it('keeps the words of a verification reference intact', async () => {
    const instance = plainToInstance(ResolveUncertainOrderDto, {
      noExecutionVerified: true,
      verificationReference: '  venue console, ticket OPS-42  ',
    });

    // trimmed at the edges, untouched inside — a reference stripped of its spaces is no longer the evidence
    expect(instance.verificationReference).toBe('venue console, ticket OPS-42');
  });

  it('accepts a verified claim with a reference', async () => {
    expect(
      await validateDto({ noExecutionVerified: true, verificationReference: 'venue console, ticket OPS-42' }),
    ).toEqual([]);
  });

  it('rejects a claim that does not assert the check was made', async () => {
    const errors = await validateDto({ noExecutionVerified: false, verificationReference: 'checked' });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('noExecutionVerified');
  });

  it('rejects a reference that is only whitespace', async () => {
    const errors = await validateDto({ noExecutionVerified: true, verificationReference: '   ' });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('verificationReference');
  });
});
