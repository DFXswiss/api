import {
  ArgumentMetadata,
  BadRequestException,
  HttpStatus,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmptyObject,
  IsOptional,
  IsString,
  ValidateNested,
  ValidationError,
} from 'class-validator';
import {
  DetailedValidationPipe,
  ValidationFailedException,
  describeRejectedValues,
} from 'src/shared/pipes/detailed-validation.pipe';

enum TestMethod {
  BANK = 'Bank',
  CARD = 'Card',
}

class NestedDto {
  @IsString()
  label: string;
}

class TestDto {
  @IsEnum(TestMethod)
  method: TestMethod;

  @IsOptional()
  @IsInt()
  amount: number;

  @IsOptional()
  @IsString()
  iban: string;

  @IsOptional()
  @IsString()
  wallet: string;

  @IsOptional()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => NestedDto)
  nested: NestedDto;
}

const metadata: ArgumentMetadata = { type: 'body', metatype: TestDto, data: '' };
const options = { whitelist: true, transformOptions: { exposeUnsetFields: false } };

async function reject(
  body: Record<string, unknown>,
  pipe: ValidationPipe = new DetailedValidationPipe(options),
): Promise<unknown> {
  try {
    await pipe.transform(body, metadata);
  } catch (error) {
    return error;
  }

  throw new Error('expected the body to be rejected');
}

async function rejectionDetail(body: Record<string, unknown>): Promise<string> {
  const error = await reject(body);
  expect(error).toBeInstanceOf(ValidationFailedException);

  return describeRejectedValues((error as ValidationFailedException).validationErrors);
}

describe('DetailedValidationPipe', () => {
  it('leaves a valid body untouched', async () => {
    const dto = await new DetailedValidationPipe(options).transform({ method: 'Bank', amount: 5 }, metadata);

    expect(dto).toMatchObject({ method: TestMethod.BANK, amount: 5 });
  });

  it('produces exactly the response body of the stock ValidationPipe', async () => {
    const body = { method: 'Crypto', amount: 'ten', nested: { label: 42 } };

    const detailed = (await reject(body)) as BadRequestException;
    const stock = (await reject(body, new ValidationPipe(options))) as BadRequestException;

    expect(detailed.getStatus()).toBe(stock.getStatus());
    expect(detailed.getResponse()).toEqual(stock.getResponse());
  });

  it('rejects with a BadRequestException that carries the raw validation errors', async () => {
    const error = (await reject({ method: 'Crypto' })) as ValidationFailedException;

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error).toBeInstanceOf(ValidationFailedException);
    expect(error.validationErrors.map((e) => e.property)).toEqual(['method']);
    expect(error.validationErrors[0].value).toBe('Crypto');
  });

  it('keeps the response of the stock pipe with disableErrorMessages, too', async () => {
    const body = { method: 'Crypto' };
    const silentOptions = { ...options, disableErrorMessages: true };

    const detailed = (await reject(body, new DetailedValidationPipe(silentOptions))) as BadRequestException;
    const stock = (await reject(body, new ValidationPipe(silentOptions))) as BadRequestException;

    expect(detailed).toBeInstanceOf(BadRequestException);
    expect(detailed.getResponse()).toEqual(stock.getResponse());
    expect(detailed.getResponse()).not.toHaveProperty('message', expect.any(Array));
  });

  it('passes the exception through when the base factory builds a non-400', async () => {
    const error = await reject(
      { method: 'Crypto' },
      new DetailedValidationPipe({ ...options, errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    );

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error).not.toBeInstanceOf(ValidationFailedException);
  });
});

describe('describeRejectedValues', () => {
  it('names the value that was rejected — the constraint message only names the field', async () => {
    await expect(rejectionDetail({ method: 'Crypto' })).resolves.toBe("method='Crypto'");
  });

  it('distinguishes a missing value from an empty and a null one', async () => {
    await expect(rejectionDetail({})).resolves.toBe('method=(missing)');
    await expect(rejectionDetail({ method: '' })).resolves.toBe("method=''");
    await expect(rejectionDetail({ method: null })).resolves.toBe('method=(null)');
  });

  it('renders a nested failure with its path', async () => {
    await expect(rejectionDetail({ method: 'Bank', nested: { label: 42 } })).resolves.toBe('nested.label=42');
  });

  it('redacts the value of a sensitive field by name', async () => {
    const detail = await rejectionDetail({ method: 'Bank', iban: 42 });

    expect(detail).toBe('iban=***');
  });

  it('masks personal data inside a value', async () => {
    const detail = await rejectionDetail({
      method: 'Bank',
      amount: 'contact foo@bar.com',
      wallet: 42,
    });

    expect(detail).not.toContain('foo@bar.com');
    expect(detail).toContain('***');
  });

  it('collapses control characters, so a value cannot forge a second log line', async () => {
    const detail = await rejectionDetail({ method: 'Bank\n2026-01-01 WARN forged' });

    expect(detail).not.toContain('\n');
    expect(detail).toContain('forged');
  });

  it('caps a long value and summarizes an oversized one by length', async () => {
    const capped = await rejectionDetail({ method: 'x'.repeat(100) });
    expect(capped).toContain('…');
    expect(capped.length).toBeLessThan(100);

    const oversized = await rejectionDetail({ method: 'x'.repeat(600) });
    expect(oversized).toBe('method=<600 chars>');
  });

  it('summarizes structured values instead of dumping the body', async () => {
    await expect(rejectionDetail({ method: ['Bank'] })).resolves.toBe('method=<array(1)>');
    await expect(rejectionDetail({ method: { a: 1 } })).resolves.toBe('method=<object>');
  });

  it('bounds the number of rendered fields and marks the rendering as incomplete', () => {
    const errors: ValidationError[] = Array.from({ length: 8 }, (_, i) => ({
      property: `field${i}`,
      value: i,
      constraints: { fail: 'nope' },
      children: [],
    }));

    const detail = describeRejectedValues(errors);

    expect(detail).toBe('field0=0, field1=1, field2=2, field3=3, field4=4, …');
  });
});
