import { Request } from 'express';
import { getClient, isRealUnitClient, isRealUnitRequest, resolveClientSource } from '../request-client';

function req(headers: Record<string, string | string[]>, originalUrl = '/v1/support'): Request {
  return { headers, originalUrl } as unknown as Request;
}

describe('request-client', () => {
  describe('isRealUnitClient', () => {
    it('matches the realunit-app client (case-insensitive)', () => {
      expect(isRealUnitClient('realunit-app')).toBe(true);
      expect(isRealUnitClient('RealUnit-App')).toBe(true);
    });

    it('does not match other or missing clients', () => {
      expect(isRealUnitClient('dfx-app')).toBe(false);
      expect(isRealUnitClient('')).toBe(false);
      expect(isRealUnitClient(undefined)).toBe(false);
    });

    it('is anchored - substrings of the client id do not match', () => {
      expect(isRealUnitClient('realunit-app-proxy')).toBe(false);
      expect(isRealUnitClient('x-realunit-app')).toBe(false);
      expect(isRealUnitClient(' realunit-app ')).toBe(true); // trimmed
    });
  });

  describe('getClient', () => {
    it('reads the x-client header, taking the first value of an array', () => {
      expect(getClient(req({ 'x-client': 'realunit-app' }))).toBe('realunit-app');
      expect(getClient(req({ 'x-client': ['realunit-app', 'x'] }))).toBe('realunit-app');
      expect(getClient(req({}))).toBe('');
    });
  });

  describe('resolveClientSource', () => {
    it('resolves the exact known clients (case-insensitive, trimmed)', () => {
      expect(resolveClientSource('realunit-app')).toBe('RealUnit');
      expect(resolveClientSource('RealUnit-App')).toBe('RealUnit');
      expect(resolveClientSource('dfx-services')).toBe('DFX');
      expect(resolveClientSource(' DFX-Services ')).toBe('DFX');
    });

    it('returns undefined for unknown, empty or missing clients - never a brand', () => {
      expect(resolveClientSource('dfx-services-proxy')).toBeUndefined();
      expect(resolveClientSource('realunit-app-proxy')).toBeUndefined();
      expect(resolveClientSource('dfx')).toBeUndefined();
      expect(resolveClientSource('')).toBeUndefined();
      expect(resolveClientSource(undefined)).toBeUndefined();
    });
  });

  describe('isRealUnitRequest', () => {
    it('detects RealUnit via the x-client header', () => {
      expect(isRealUnitRequest(req({ 'x-client': 'realunit-app' }))).toBe(true);
    });

    it('detects RealUnit via the /v{n}/realunit/ path (legacy app builds)', () => {
      expect(isRealUnitRequest(req({}, '/v1/realunit/register'))).toBe(true);
    });

    it('is false for a plain DFX request (no header, non-realunit path)', () => {
      expect(isRealUnitRequest(req({}, '/v1/support'))).toBe(false);
    });
  });
});
