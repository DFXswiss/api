import { ArgumentMetadata } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DetailedValidationPipe } from 'src/shared/pipes/detailed-validation.pipe';
import { CreateFiatOutputDto } from '../create-fiat-output.dto';
import { UpdateFiatOutputDto } from '../update-fiat-output.dto';
import { FiatOutputType } from '../../fiat-output.entity';

describe('CreateFiatOutputDto', () => {
  const baseDto = {
    type: FiatOutputType.BUY_FIAT,
    amount: 100,
    currency: 'EUR',
    name: 'Test',
    address: 'Street',
    city: 'Zurich',
    iban: 'CH9300762011623852957',
    zip: '8000',
    country: 'CH',
  };

  const pipe = new DetailedValidationPipe({ whitelist: true, transformOptions: { exposeUnsetFields: false } });
  const metadata: ArgumentMetadata = { type: 'body', metatype: CreateFiatOutputDto, data: '' };

  const validateDto = async (raw: Record<string, unknown>) => {
    const instance = plainToInstance(CreateFiatOutputDto, raw);
    return validate(instance);
  };

  it('accepts a valid ISO date', async () => {
    const errors = await validateDto({ ...baseDto, valutaDate: '2026-07-22' });
    expect(errors).toEqual([]);
  });

  it('accepts the inclusive MinDate boundary 2000-01-01T00:00:00Z', async () => {
    const errors = await validateDto({ ...baseDto, valutaDate: '2000-01-01T00:00:00Z' });
    expect(errors).toEqual([]);
  });

  it('rejects a numeric spreadsheet date serial', async () => {
    const errors = await validateDto({ ...baseDto, valutaDate: 46225 });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('minDate');
  });

  it.each([true, false])('accepts isInstant=%s', async (isInstant) => {
    const dto = await pipe.transform({ ...baseDto, isInstant }, metadata);
    expect(dto.isInstant).toBe(isInstant);
  });

  it('rejects a string value for isInstant', async () => {
    await expect(pipe.transform({ ...baseDto, isInstant: 'true' }, metadata)).rejects.toThrow();
  });
});

describe('UpdateFiatOutputDto date fields', () => {
  const dateFields = [
    'valutaDate',
    'isReadyDate',
    'isTransmittedDate',
    'isConfirmedDate',
    'isApprovedDate',
    'outputDate',
  ] as const;

  const validateDto = async (raw: Record<string, unknown>) => {
    const instance = plainToInstance(UpdateFiatOutputDto, raw);
    return validate(instance);
  };

  it.each(dateFields)('%s accepts a valid ISO date', async (field) => {
    const errors = await validateDto({ [field]: '2026-07-22' });
    expect(errors.filter((e) => e.property === field && e.constraints?.minDate)).toEqual([]);
  });

  it.each(dateFields)('%s rejects a numeric spreadsheet date serial', async (field) => {
    const errors = await validateDto({ [field]: 46225 });
    const fieldError = errors.find((e) => e.property === field);
    expect(fieldError).toBeDefined();
    expect(fieldError!.constraints).toHaveProperty('minDate');
  });
});
