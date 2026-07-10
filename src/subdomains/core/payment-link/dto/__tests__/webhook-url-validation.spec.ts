import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateInvoicePaymentDto } from '../create-invoice-payment.dto';
import { CreatePaymentLinkDto } from '../create-payment-link.dto';
import { UpdatePaymentLinkDto } from '../update-payment-link.dto';

// PaymentWebhookService fires an unauthenticated server-side POST to whatever webhookUrl the
// merchant registers. @IsUrl() alone accepts private/loopback/link-local targets (e.g.
// http://0.0.0.0:9999, the cloud metadata address), so registration-time validation must also
// reject those.
describe.each([
  ['CreatePaymentLinkDto', CreatePaymentLinkDto],
  ['UpdatePaymentLinkDto', UpdatePaymentLinkDto],
  ['CreateInvoicePaymentDto', CreateInvoicePaymentDto],
])('%s.webhookUrl SSRF validation', (_, DtoClass) => {
  const validateWebhookUrl = async (webhookUrl: unknown) => {
    const instance = plainToInstance(DtoClass, { webhookUrl });
    const errors = await validate(instance);
    return errors.find((e) => e.property === 'webhookUrl');
  };

  it('accepts a public https URL', async () => {
    expect(await validateWebhookUrl('https://merchant.example.com/webhook')).toBeUndefined();
  });

  it('rejects the unspecified address 0.0.0.0', async () => {
    const error = await validateWebhookUrl('http://0.0.0.0:9999');
    expect(error?.constraints).toHaveProperty('IsSsrfSafeUrl');
  });

  it('rejects loopback 127.0.0.1', async () => {
    const error = await validateWebhookUrl('http://127.0.0.1/x');
    expect(error?.constraints).toHaveProperty('IsSsrfSafeUrl');
  });

  it('rejects private range 10.0.0.0/8', async () => {
    const error = await validateWebhookUrl('http://10.1.2.3/x');
    expect(error?.constraints).toHaveProperty('IsSsrfSafeUrl');
  });

  it('rejects private range 192.168.0.0/16', async () => {
    const error = await validateWebhookUrl('http://192.168.1.1/x');
    expect(error?.constraints).toHaveProperty('IsSsrfSafeUrl');
  });

  it('rejects the cloud metadata address 169.254.169.254', async () => {
    const error = await validateWebhookUrl('http://169.254.169.254/latest/meta-data');
    expect(error?.constraints).toHaveProperty('IsSsrfSafeUrl');
  });

  it('rejects a non-http(s) scheme', async () => {
    // @IsUrl() alone accepts ftp:// by default; IsSsrfSafeUrl is what actually restricts this
    const error = await validateWebhookUrl('ftp://example.com');
    expect(error?.constraints).toHaveProperty('IsSsrfSafeUrl');
  });

  it('rejects a plain non-URL string', async () => {
    const error = await validateWebhookUrl('not a url');
    expect(error?.constraints).toHaveProperty('isUrl');
  });

  it('accepts an omitted value', async () => {
    expect(await validateWebhookUrl(undefined)).toBeUndefined();
  });
});

// CreateInvoicePaymentDto also exposes the same webhook target via the short `w` alias, which reaches
// the identical sink and must be guarded too.
describe('CreateInvoicePaymentDto.w (webhookUrl alias) SSRF validation', () => {
  const validateW = async (w: unknown) => {
    const instance = plainToInstance(CreateInvoicePaymentDto, { w });
    const errors = await validate(instance);
    return errors.find((e) => e.property === 'w');
  };

  it('accepts a public https URL', async () => {
    expect(await validateW('https://merchant.example.com/webhook')).toBeUndefined();
  });

  it('rejects a private/loopback target', async () => {
    const metadata = await validateW('http://169.254.169.254/latest/meta-data');
    expect(metadata?.constraints).toHaveProperty('IsSsrfSafeUrl');

    const loopback = await validateW('http://127.0.0.1/x');
    expect(loopback?.constraints).toHaveProperty('IsSsrfSafeUrl');
  });

  it('accepts an omitted value', async () => {
    expect(await validateW(undefined)).toBeUndefined();
  });
});
