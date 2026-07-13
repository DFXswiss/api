// Mock the `opentimestamps` npm library so stamp/upgrade/verify can be exercised WITHOUT any
// network access. We mock exactly the surface OpenTimestampsService touches:
//   - OpenTimestamps.stamp / .upgrade / .verify           (promise-returning network calls)
//   - OpenTimestamps.DetachedTimestampFile.fromHash       (sync constructor from a digest)
//   - OpenTimestamps.DetachedTimestampFile.deserialize    (sync constructor from .ots bytes)
//   - OpenTimestamps.Ops.OpSHA256                         (sync op constructor)
// Each fake DetachedTimestampFile carries a `serializeToBytes()` returning a recognizable byte
// array so we can assert on the bytes the service returns.

const stampMock = jest.fn();
const upgradeMock = jest.fn();
const verifyMock = jest.fn();
const fromHashMock = jest.fn();
const deserializeMock = jest.fn();
const opSHA256Mock = jest.fn();

jest.mock('opentimestamps', () => ({
  stamp: (...args: any[]) => stampMock(...args),
  upgrade: (...args: any[]) => upgradeMock(...args),
  verify: (...args: any[]) => verifyMock(...args),
  DetachedTimestampFile: {
    fromHash: (...args: any[]) => fromHashMock(...args),
    deserialize: (...args: any[]) => deserializeMock(...args),
  },
  Ops: {
    OpSHA256: function OpSHA256(this: any) {
      opSHA256Mock();
    },
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { OpenTimestampsService } from '../opentimestamps.service';

/** A fake DetachedTimestampFile whose serialized form is deterministic for assertions. */
function fakeDetached(serialized: number[]) {
  return {
    serializeToBytes: jest.fn(() => serialized),
  };
}

describe('OpenTimestampsService', () => {
  let service: OpenTimestampsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [OpenTimestampsService],
    }).compile();

    service = module.get<OpenTimestampsService>(OpenTimestampsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('stamp', () => {
    it('builds a detached file from the digest, submits it and returns the serialized .ots bytes', async () => {
      const digest = Buffer.alloc(32, 7);
      const serialized = [1, 2, 3, 4];
      const detached = fakeDetached(serialized);
      fromHashMock.mockReturnValue(detached);
      stampMock.mockResolvedValue(undefined);

      const result = await service.stamp(digest);

      // a SHA-256 op was constructed and fromHash was called with that op + the raw digest
      expect(opSHA256Mock).toHaveBeenCalledTimes(1);
      expect(fromHashMock).toHaveBeenCalledTimes(1);
      const [, passedDigest] = fromHashMock.mock.calls[0];
      expect(passedDigest).toBe(digest);

      // the library stamp was invoked on exactly that detached file
      expect(stampMock).toHaveBeenCalledTimes(1);
      expect(stampMock).toHaveBeenCalledWith(detached);

      // and the returned bytes are a Buffer wrapping the serialized form
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(Buffer.from(serialized));
      expect(detached.serializeToBytes).toHaveBeenCalledTimes(1);
    });

    it('propagates a calendar/network failure from the library', async () => {
      fromHashMock.mockReturnValue(fakeDetached([0]));
      stampMock.mockRejectedValue(new Error('calendar unreachable'));

      await expect(service.stamp(Buffer.alloc(32))).rejects.toThrow('calendar unreachable');
    });
  });

  describe('upgrade', () => {
    it('returns the re-serialized bytes when the proof changed', async () => {
      const otsBytes = Buffer.from([9, 9, 9]);
      const upgradedSerialized = [5, 6, 7, 8];
      const detached = fakeDetached(upgradedSerialized);
      deserializeMock.mockReturnValue(detached);
      upgradeMock.mockResolvedValue(true); // changed

      const result = await service.upgrade(otsBytes);

      expect(deserializeMock).toHaveBeenCalledWith(otsBytes);
      expect(upgradeMock).toHaveBeenCalledWith(detached);
      expect(detached.serializeToBytes).toHaveBeenCalledTimes(1);
      expect(result).toEqual(Buffer.from(upgradedSerialized));
      // genuinely new bytes, not the original
      expect(result.equals(otsBytes)).toBe(false);
    });

    it('returns the original bytes unchanged when nothing changed', async () => {
      const otsBytes = Buffer.from([9, 9, 9]);
      const detached = fakeDetached([1, 1, 1]);
      deserializeMock.mockReturnValue(detached);
      upgradeMock.mockResolvedValue(false); // unchanged

      const result = await service.upgrade(otsBytes);

      // exact same buffer reference is returned, serialize is never consulted
      expect(result).toBe(otsBytes);
      expect(detached.serializeToBytes).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('reports confirmed with the Bitcoin height when an attestation is present', async () => {
      const digest = Buffer.alloc(32, 1);
      const otsBytes = Buffer.from([4, 2]);
      const detachedOts = fakeDetached([]);
      const detachedDigest = fakeDetached([]);
      deserializeMock.mockReturnValue(detachedOts);
      fromHashMock.mockReturnValue(detachedDigest);
      verifyMock.mockResolvedValue({ bitcoin: { height: 840123, timestamp: 1700000000 } });

      const result = await service.verify(digest, otsBytes);

      // proof deserialized, digest re-derived, and verify run against the trusted explorers
      expect(deserializeMock).toHaveBeenCalledWith(otsBytes);
      expect(fromHashMock).toHaveBeenCalledTimes(1);
      expect(verifyMock).toHaveBeenCalledWith(detachedOts, detachedDigest, { ignoreBitcoinNode: true });

      expect(result).toEqual({ bitcoin: { height: 840123 }, confirmed: true, pending: false });
    });

    it('reports pending when the library returns no attestation (undefined result)', async () => {
      deserializeMock.mockReturnValue(fakeDetached([]));
      fromHashMock.mockReturnValue(fakeDetached([]));
      verifyMock.mockResolvedValue(undefined);

      const result = await service.verify(Buffer.alloc(32), Buffer.from([1]));

      expect(result).toEqual({ confirmed: false, pending: true });
      expect(result.bitcoin).toBeUndefined();
    });

    it('reports pending when the result has no bitcoin attestation', async () => {
      deserializeMock.mockReturnValue(fakeDetached([]));
      fromHashMock.mockReturnValue(fakeDetached([]));
      verifyMock.mockResolvedValue({});

      const result = await service.verify(Buffer.alloc(32), Buffer.from([1]));

      expect(result).toEqual({ confirmed: false, pending: true });
    });

    it('reports pending when the bitcoin field lacks a numeric height', async () => {
      deserializeMock.mockReturnValue(fakeDetached([]));
      fromHashMock.mockReturnValue(fakeDetached([]));
      verifyMock.mockResolvedValue({ bitcoin: {} });

      const result = await service.verify(Buffer.alloc(32), Buffer.from([1]));

      expect(result).toEqual({ confirmed: false, pending: true });
    });
  });
});
