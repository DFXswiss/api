import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { DetailedValidationPipe } from 'src/shared/pipes/detailed-validation.pipe';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { GetBuyPaymentInfoDto, PersonalIbanProvider } from '../get-buy-payment-info.dto';

describe('GetBuyPaymentInfoDto.personalIbanProvider', () => {
  // Mirror the production global pipe (src/main.ts): custom decorator messages must surface as-is
  // in the 400 body.
  const pipe = new DetailedValidationPipe({ whitelist: true, transformOptions: { exposeUnsetFields: false } });
  const metadata: ArgumentMetadata = { type: 'body', metatype: GetBuyPaymentInfoDto, data: '' };

  const validBody = {
    currency: { id: 1 },
    asset: { id: 1 },
    amount: 100,
    paymentMethod: FiatPaymentMethod.BANK,
    exactPrice: false,
  };

  it('accepts a known PersonalIbanProvider value', async () => {
    const dto = await pipe.transform({ ...validBody, personalIbanProvider: PersonalIbanProvider.FRICK }, metadata);
    expect(dto.personalIbanProvider).toBe(PersonalIbanProvider.FRICK);
  });

  it("rejects a typo'd provider with PersonalIbanProviderUnsupported (not generic isEnum text)", async () => {
    let caught: unknown;
    try {
      await pipe.transform({ ...validBody, personalIbanProvider: 'frikc' }, metadata);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const response = (caught as BadRequestException).getResponse() as {
      statusCode: number;
      message: string | string[];
    };
    expect(response.statusCode).toBe(400);
    const messageText = Array.isArray(response.message) ? response.message.join(' ') : String(response.message);
    expect(messageText).toContain(QuoteError.PERSONAL_IBAN_PROVIDER_UNSUPPORTED);
    expect(messageText).not.toMatch(/must be one of the following values/i);
  });
});
