import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmDto } from '../confirm.dto';

// `txHash` is used as-is for the pay-in and later queried on-chain by the confirmation job.
// A malformed hash (e.g. 65 hex chars) can never confirm, so it must be rejected at the DTO level.
describe('ConfirmDto.txHash format', () => {
  const validateDto = async (raw: Record<string, unknown>) => {
    const instance = plainToInstance(ConfirmDto, raw);
    return validate(instance);
  };

  it('accepts a valid transaction hash', async () => {
    const errors = await validateDto({
      txHash: '0xb1f2c3a4d5e6f70819a2b3c4d5e6f7081920a3b4c5d6e7f8091a2b3c4d5e6f70',
    });
    expect(errors).toEqual([]);
  });

  it('rejects a hash with 65 hex characters', async () => {
    const errors = await validateDto({
      txHash: '0xb1f2c3a4d5e6f70819a2b3c4d5e6f7081920a3b4c5d6e7f8091a2b3c4d5e6f708',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('rejects a hash with 63 hex characters', async () => {
    const errors = await validateDto({
      txHash: '0xb1f2c3a4d5e6f70819a2b3c4d5e6f7081920a3b4c5d6e7f8091a2b3c4d5e6f7',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('rejects a hash without 0x prefix', async () => {
    const errors = await validateDto({
      txHash: 'b1f2c3a4d5e6f70819a2b3c4d5e6f7081920a3b4c5d6e7f8091a2b3c4d5e6f70',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('rejects a hash with non-hex characters', async () => {
    const errors = await validateDto({
      txHash: '0xz1f2c3a4d5e6f70819a2b3c4d5e6f7081920a3b4c5d6e7f8091a2b3c4d5e6f70',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('accepts an omitted value', async () => {
    const errors = await validateDto({});
    expect(errors).toEqual([]);
  });
});
