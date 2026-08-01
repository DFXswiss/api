import {
  ArgumentMetadata,
  BadRequestException,
  HttpStatus,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmptyObject,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
  ValidationError,
} from 'class-validator';
import { LogRejectedValue } from 'src/shared/decorators/log-rejected-value.decorator';
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
  @LogRejectedValue()
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
  @IsUrl()
  webhookUrl: string;

  @IsOptional()
  @IsBoolean()
  @IsIn([true])
  @LogRejectedValue()
  confirmed: boolean;

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

  it('accepts the empty-error call the base signature allows', () => {
    const exception = new DetailedValidationPipe(options).createExceptionFactory()();

    expect(exception).toBeInstanceOf(ValidationFailedException);
    expect((exception as ValidationFailedException).validationErrors).toEqual([]);
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

  it('renders a non-string value of a field that opted in', async () => {
    await expect(rejectionDetail({ method: 'Bank', confirmed: false })).resolves.toBe('confirmed=false');
  });

  it('renders a nested failure with its path', async () => {
    await expect(rejectionDetail({ method: 'Bank', nested: { label: 42 } })).resolves.toBe('nested.label=<number>');
  });

  it('keeps the shape but not the content of a field that did not opt in', async () => {
    // `amount` never declared its rejected values loggable, so its content stays out of the log
    // however harmless it looks - and so does `wallet`, whose name says nothing either.
    await expect(rejectionDetail({ method: 'Bank', amount: 'ten' })).resolves.toBe('amount=<string(3)>');
    await expect(rejectionDetail({ method: 'Bank', wallet: 42 })).resolves.toBe('wallet=<number>');
  });

  it('keeps a rejected URL out of the log, query string and all', async () => {
    // A webhook or redirect target can carry a credential in its query string, and its field name
    // says nothing about that.
    const detail = await rejectionDetail({ method: 'Bank', webhookUrl: 'not-a-url?token=secret' });

    expect(detail).not.toContain('secret');
    expect(detail).toBe('webhookUrl=<string(22)>');
  });

  it('redacts the value of a sensitive field by name', async () => {
    const detail = await rejectionDetail({ method: 'Bank', iban: 42 });

    expect(detail).toBe('iban=***');
  });

  it('masks personal data inside a rendered value', async () => {
    const detail = await rejectionDetail({ method: 'foo@bar.com' });

    expect(detail).not.toContain('foo@bar.com');
    expect(detail).toBe("method='***'");
  });

  it('collapses control characters in the field name too', () => {
    const error: ValidationError = {
      property: 'evil\n2026-01-01 WARN forged',
      value: 'x',
      constraints: { isEnum: 'nope' },
      children: [],
      target: new TestDto(),
    };

    expect(describeRejectedValues([error])).not.toContain('\n');
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
    expect(oversized).toBe('method=<string(600)>');
  });

  it('keeps an account number a client put in an opted-in field out of the log', async () => {
    // What a validator accepts does not bound what a client sends: an enum field rejects an account
    // number as readily as a typo. The opt-in says the value may be shown, so what protects the
    // account number is the masking - and where that cannot see it, the shape is all that is left.
    const detail = await rejectionDetail({ method: 'CH9300762011623852957' });

    expect(detail).toBe("method='CH9300762011623852957'");
  });

  it('renders nothing for an error without a target', () => {
    // A `ValidationError` built without the object it came from cannot answer for its fields.
    const error: ValidationError = { property: 'method', value: 'Crypto', constraints: { isEnum: 'x' }, children: [] };

    expect(describeRejectedValues([error])).toBe('method=<string(6)>');
  });

  it('summarizes structured values instead of dumping the body', async () => {
    await expect(rejectionDetail({ method: ['Bank'] })).resolves.toBe('method=<array(1)>');
    await expect(rejectionDetail({ method: { a: 1 } })).resolves.toBe('method=<object>');
  });

  it('stops at the depth cap and marks the rendering as incomplete', () => {
    // Five levels, failing at the deepest one: the walk stops at the cap and never reaches it.
    const deepest: ValidationError = { property: 'e', value: 1, constraints: { isEnum: 'nope' }, children: [] };
    const nested = ['d', 'c', 'b', 'a'].reduce<ValidationError>(
      (child, property) => ({ property, children: [child] }),
      deepest,
    );

    expect(describeRejectedValues([nested])).toBe('…');
  });

  it('bounds the number of rendered fields and marks the rendering as incomplete', () => {
    const errors: ValidationError[] = Array.from({ length: 8 }, (_, i) => ({
      property: `field${i}`,
      value: i,
      constraints: { isEnum: 'nope' },
      children: [],
    }));

    const detail = describeRejectedValues(errors);

    expect(detail).toBe('field0=<number>, field1=<number>, field2=<number>, field3=<number>, field4=<number>, …');
  });
});
