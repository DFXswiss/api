import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFiatOutputDto } from '../create-fiat-output.dto';
import { FiatOutputType } from '../../fiat-output.entity';

describe('CreateFiatOutputDto.valutaDate', () => {
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

  const validateDto = async (raw: Record<string, unknown>) => {
    const instance = plainToInstance(CreateFiatOutputDto, raw);
    return validate(instance);
  };

  it('accepts a valid ISO date', async () => {
    const errors = await validateDto({ ...baseDto, valutaDate: '2026-07-22' });
    expect(errors).toEqual([]);
  });

  it('rejects a numeric spreadsheet date serial', async () => {
    const errors = await validateDto({ ...baseDto, valutaDate: 46225 });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('minDate');
  });
});
