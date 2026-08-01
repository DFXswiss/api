import { ArgumentMetadata } from '@nestjs/common';
import {
  DetailedValidationPipe,
  ValidationFailedException,
  describeRejectedValues,
} from 'src/shared/pipes/detailed-validation.pipe';
import { GetBuyQuoteDto } from '../get-buy-quote.dto';

// The 400 body names the field and the accepted values, not the value that arrived. These cases
// pin what the log line shows instead, for the two rejections this DTO can produce.
describe('GetBuyQuoteDto rejections', () => {
  // Mirrors the production global pipe (src/main.ts).
  const pipe = new DetailedValidationPipe({ whitelist: true, transformOptions: { exposeUnsetFields: false } });
  const metadata: ArgumentMetadata = { type: 'body', metatype: GetBuyQuoteDto, data: '' };

  const body = { currency: { id: 1 }, asset: { id: 1 } };

  async function rejectionDetail(input: Record<string, unknown>): Promise<string> {
    try {
      await pipe.transform(input, metadata);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailedException);
      return describeRejectedValues((error as ValidationFailedException).validationErrors);
    }

    throw new Error('expected the body to be rejected');
  }

  it('names the payment method that was sent, not just the accepted ones', async () => {
    // 'Crypto' is a value of the wider `PaymentMethod` union (payment-method.enum.ts); this DTO
    // accepts `FiatPaymentMethod` only.
    await expect(rejectionDetail({ ...body, amount: 100, paymentMethod: 'Crypto' })).resolves.toBe(
      "paymentMethod='Crypto'",
    );
  });

  it('distinguishes both amounts missing from both amounts set', async () => {
    await expect(rejectionDetail({ ...body })).resolves.toBe('amount=(missing), targetAmount=(missing)');
    await expect(rejectionDetail({ ...body, amount: 100, targetAmount: 1 })).resolves.toBe(
      'amount=100, targetAmount=1',
    );
  });

  it('accepts a valid body unchanged', async () => {
    const dto = await pipe.transform({ ...body, amount: 100, paymentMethod: 'Bank' }, metadata);

    expect(dto.amount).toBe(100);
    expect(dto.paymentMethod).toBe('Bank');
  });
});
