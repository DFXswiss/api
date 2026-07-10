import { isSsrfSafeUrl } from '../is-ssrf-safe-url.validator';

describe('isSsrfSafeUrl', () => {
  it('accepts a public https URL', () => {
    expect(isSsrfSafeUrl('https://example.com/webhook')).toBe(true);
  });

  it('accepts a public http URL', () => {
    expect(isSsrfSafeUrl('http://api.merchant.com:8443/hook')).toBe(true);
  });

  it('rejects the unspecified address 0.0.0.0', () => {
    expect(isSsrfSafeUrl('http://0.0.0.0:9999')).toBe(false);
  });

  it('rejects loopback 127.0.0.1', () => {
    expect(isSsrfSafeUrl('http://127.0.0.1/x')).toBe(false);
  });

  it('rejects private range 10.0.0.0/8', () => {
    expect(isSsrfSafeUrl('http://10.1.2.3/x')).toBe(false);
  });

  it('rejects private range 192.168.0.0/16', () => {
    expect(isSsrfSafeUrl('http://192.168.1.1/x')).toBe(false);
  });

  it('rejects private range 172.16.0.0/12', () => {
    expect(isSsrfSafeUrl('http://172.16.0.5')).toBe(false);
  });

  it('accepts a public address just outside the 172.16.0.0/12 range', () => {
    expect(isSsrfSafeUrl('http://172.32.0.5')).toBe(true);
  });

  it('rejects the cloud metadata address 169.254.169.254', () => {
    expect(isSsrfSafeUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
  });

  it('rejects CGNAT range 100.64.0.0/10', () => {
    expect(isSsrfSafeUrl('http://100.64.0.1/x')).toBe(false);
    expect(isSsrfSafeUrl('http://100.127.255.254/x')).toBe(false);
  });

  it('accepts public addresses just outside the 100.64.0.0/10 range', () => {
    expect(isSsrfSafeUrl('http://100.63.255.255/x')).toBe(true);
    expect(isSsrfSafeUrl('http://100.128.0.1/x')).toBe(true);
  });

  it('rejects the whole 0.0.0.0/8 range', () => {
    expect(isSsrfSafeUrl('http://0.1.2.3/x')).toBe(false);
  });

  it('rejects multicast addresses', () => {
    expect(isSsrfSafeUrl('http://224.0.0.1')).toBe(false);
  });

  it('rejects reserved addresses', () => {
    expect(isSsrfSafeUrl('http://240.0.0.1')).toBe(false);
  });

  it('rejects IPv6 loopback', () => {
    expect(isSsrfSafeUrl('http://[::1]/x')).toBe(false);
  });

  it('rejects IPv6 link-local', () => {
    expect(isSsrfSafeUrl('http://[fe80::1]/x')).toBe(false);
  });

  it('rejects IPv6 unique-local addresses', () => {
    expect(isSsrfSafeUrl('http://[fc00::1]/x')).toBe(false);
    expect(isSsrfSafeUrl('http://[fd12:3456:789a::1]/x')).toBe(false);
  });

  it('rejects an IPv4-mapped IPv6 loopback address', () => {
    expect(isSsrfSafeUrl('http://[::ffff:127.0.0.1]/x')).toBe(false);
  });

  it('rejects the IPv4-mapped IPv6 cloud metadata address', () => {
    expect(isSsrfSafeUrl('http://[::ffff:169.254.169.254]/x')).toBe(false);
  });

  it('rejects the literal hostname localhost', () => {
    expect(isSsrfSafeUrl('http://localhost:3000')).toBe(false);
  });

  it('rejects a non-http(s) scheme', () => {
    expect(isSsrfSafeUrl('ftp://example.com')).toBe(false);
  });

  it('rejects a plain non-URL string', () => {
    expect(isSsrfSafeUrl('not a url')).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(isSsrfSafeUrl(undefined)).toBe(false);
  });
});
