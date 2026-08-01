import { Request } from 'express';
import { describeCaller } from 'src/shared/utils/request-caller';

describe('describeCaller', () => {
  const req = (headers: Record<string, string | string[]>) => ({ headers }) as unknown as Request;

  it('reports the X-Client value', () => {
    expect(describeCaller(req({ 'x-client': 'dfx-services' }))).toBe('client=dfx-services');
  });

  it('reports an absent client explicitly, so an unattributable caller is visible as such', () => {
    expect(describeCaller(req({}))).toBe('client=(none)');
  });

  it('adds the requesting site and the user agent', () => {
    const caller = describeCaller(
      req({ 'x-client': 'dfx-services', origin: 'https://app.dfx.swiss', 'user-agent': 'Mozilla/5.0 (X11)' }),
    );

    expect(caller).toBe('client=dfx-services origin=https://app.dfx.swiss ua=Mozilla/5.0 (X11)');
  });

  it('reduces the origin header to its origin too — it arrives from the client like the rest', () => {
    const caller = describeCaller(req({ origin: 'https://partner.example.com/checkout?token=secret' }));

    expect(caller).toBe('client=(none) origin=https://partner.example.com');
  });

  it('falls back to the origin of the referer, dropping its path and query', () => {
    const caller = describeCaller(req({ referer: 'https://partner.example.com/checkout?token=secret&mail=a@b.ch' }));

    expect(caller).toContain('origin=https://partner.example.com');
    expect(caller).not.toContain('secret');
    expect(caller).not.toContain('checkout');
  });

  it('prefers Origin over Referer', () => {
    const caller = describeCaller(req({ origin: 'https://a.example.com', referer: 'https://b.example.com/x' }));

    expect(caller).toContain('origin=https://a.example.com');
    expect(caller).not.toContain('b.example.com');
  });

  it('drops an unparsable value rather than logging it raw', () => {
    expect(describeCaller(req({ referer: 'not a url' }))).toBe('client=(none)');
    expect(describeCaller(req({ origin: 'not a url' }))).toBe('client=(none)');
  });

  it('keeps an opaque origin — having none to name says something too', () => {
    expect(describeCaller(req({ origin: 'null' }))).toBe('client=(none) origin=null');
    // It yields an origin, so it wins over the referer like any other origin would.
    expect(describeCaller(req({ origin: 'null', referer: 'https://partner.example.com/x' }))).toBe(
      'client=(none) origin=null',
    );
  });

  it('falls back to the referer when the origin yields nothing, not just when it is absent', () => {
    const caller = describeCaller(req({ origin: 'not a url', referer: 'https://partner.example.com/x?t=1' }));

    expect(caller).toBe('client=(none) origin=https://partner.example.com');
  });

  it('takes the first value of a tampered array header', () => {
    expect(describeCaller(req({ 'x-client': ['dfx-services', 'other'] }))).toBe('client=dfx-services');
    expect(describeCaller(req({ 'x-client': [], origin: [] }))).toBe('client=(none)');
  });

  it('collapses control characters, so a header cannot forge a second log line', () => {
    const caller = describeCaller(req({ 'x-client': 'a\n2026-01-01 WARN forged' }));

    expect(caller).not.toContain('\n');
  });

  it('caps each header, so an oversized one cannot flood the log line', () => {
    const caller = describeCaller(
      req({ 'x-client': 'c'.repeat(500), origin: 'o'.repeat(500), 'user-agent': 'u'.repeat(500) }),
    );

    expect(caller.length).toBeLessThan(250);
  });

  it('survives a request without headers — the filter must not turn a 400 into a 500', () => {
    expect(describeCaller({} as Request)).toBe('client=(none)');
  });
});
