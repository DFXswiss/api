import { Config, Environment } from 'src/config/config';
import { SumSubWebhookResult } from '../../../dto/sum-sub.dto';
import { SumsubService } from '../sum-sub.service';

jest.mock('src/config/config', () => {
  const actual = jest.requireActual('src/config/config');
  return { ...actual, Config: { environment: undefined, kyc: {} } };
});

describe('SumsubService.isSandboxWebhookOnProd', () => {
  const webhook = (sandboxMode?: boolean): SumSubWebhookResult => ({
    applicantId: 'a1',
    externalUserId: 'dfx-api-prd-sumsubauto-1-0-abc',
    sandboxMode,
    createdAt: new Date(),
  });

  afterEach(() => {
    (Config as { environment?: Environment }).environment = undefined;
  });

  it('rejects a sandbox webhook on production', () => {
    (Config as { environment?: Environment }).environment = Environment.PRD;
    expect(SumsubService.isSandboxWebhookOnProd(webhook(true))).toBe(true);
  });

  it('accepts a production webhook on production', () => {
    (Config as { environment?: Environment }).environment = Environment.PRD;
    expect(SumsubService.isSandboxWebhookOnProd(webhook(false))).toBe(false);
  });

  it('accepts a webhook without the sandboxMode flag on production', () => {
    // A dropped field must never stall production ident — the guard is deliberately narrow.
    (Config as { environment?: Environment }).environment = Environment.PRD;
    expect(SumsubService.isSandboxWebhookOnProd(webhook(undefined))).toBe(false);
  });

  it('accepts a sandbox webhook on dev', () => {
    (Config as { environment?: Environment }).environment = Environment.DEV;
    expect(SumsubService.isSandboxWebhookOnProd(webhook(true))).toBe(false);
  });

  it('accepts a sandbox webhook on loc', () => {
    (Config as { environment?: Environment }).environment = Environment.LOC;
    expect(SumsubService.isSandboxWebhookOnProd(webhook(true))).toBe(false);
  });
});
