/**
 * Focused unit test for the InternetComputerClient broadcast boundary: the try/catch tightly
 * wrapping the actual update call (ledger.icrc1Transfer / tokenLedger.transfer), which translates
 * any failure at/after that ambiguous IC update call into a TxBroadcastError. Building the transfer
 * request (Principal parsing, amount conversion) happens BEFORE the try and must keep propagating
 * as a plain, provably pre-broadcast error - same boundary shape as cardano-client.spec.ts /
 * solana-client.spec.ts.
 *
 * InternetComputerClient's constructor wires up a real wallet/agent from a seed and other
 * collaborators that need live config. To isolate JUST the changed methods, we call the private
 * prototype methods directly via Function.prototype.call against a minimal stub `this`, following
 * the same pattern as evm/cardano/solana-client.spec.ts.
 */

import { IcpLedgerCanister } from '@dfinity/ledger-icp';
import { IcrcLedgerCanister } from '@dfinity/ledger-icrc';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { InternetComputerClient } from '../icp-client';

const proto = InternetComputerClient.prototype as any;

// Real, checksum-valid IC principal texts (management canister / ICP ledger canister). No network
// call is made - Principal.fromText only needs a well-formed textual principal to parse locally.
const VALID_PRINCIPAL = 'aaaaa-aa';
const VALID_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

function createClientStub(host = 'https://icp-host.example'): any {
  const client = Object.create(InternetComputerClient.prototype);
  client.host = host;
  return client;
}

function createWalletStub(): any {
  return { getAgent: jest.fn().mockReturnValue({ agent: true }) };
}

describe('InternetComputerClient - broadcast boundary', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendNativeCoin(...)', () => {
    it('returns the block index as a string on a successful icrc1Transfer', async () => {
      const icrc1Transfer = jest.fn().mockResolvedValue(42n);
      jest.spyOn(IcpLedgerCanister, 'create').mockReturnValue({ icrc1Transfer } as any);
      const client = createClientStub();
      const wallet = createWalletStub();

      const result = await proto.sendNativeCoin.call(client, wallet, VALID_PRINCIPAL, 1);

      expect(result).toBe('42');
      expect(icrc1Transfer).toHaveBeenCalledWith({
        to: { owner: expect.anything(), subaccount: [] },
        amount: 100000000n,
      });
    });

    it('wraps an Error thrown by icrc1Transfer into a TxBroadcastError, preserving message and cause', async () => {
      const sendError = new Error('IC boundary node timeout');
      const icrc1Transfer = jest.fn().mockRejectedValue(sendError);
      jest.spyOn(IcpLedgerCanister, 'create').mockReturnValue({ icrc1Transfer } as any);
      const client = createClientStub();
      const wallet = createWalletStub();

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, wallet, VALID_PRINCIPAL, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('IC boundary node timeout');
      expect((error as TxBroadcastError).cause).toBe(sendError);
    });

    it('wraps a non-Error rejection from icrc1Transfer into a TxBroadcastError via String(e)', async () => {
      const icrc1Transfer = jest.fn().mockRejectedValue('reject-timeout');
      jest.spyOn(IcpLedgerCanister, 'create').mockReturnValue({ icrc1Transfer } as any);
      const client = createClientStub();
      const wallet = createWalletStub();

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, wallet, VALID_PRINCIPAL, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('reject-timeout');
      expect((error as TxBroadcastError).cause).toBe('reject-timeout');
    });

    it('does not wrap a failure from building the transfer request (pre-broadcast, plain error propagates unchanged)', async () => {
      const icrc1Transfer = jest.fn();
      jest.spyOn(IcpLedgerCanister, 'create').mockReturnValue({ icrc1Transfer } as any);
      const client = createClientStub();
      const wallet = createWalletStub();

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, wallet, 'not-a-valid-principal', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect(icrc1Transfer).not.toHaveBeenCalled(); // broadcast never reached
    });
  });

  describe('sendToken(...)', () => {
    const token = createCustomAsset({ chainId: VALID_CANISTER_ID, decimals: 8, uniqueName: 'ICP/ckBTC' });

    it('returns "canisterId:blockIndex" on a successful transfer', async () => {
      const transfer = jest.fn().mockResolvedValue(7n);
      jest.spyOn(IcrcLedgerCanister, 'create').mockReturnValue({ transfer } as any);
      const client = createClientStub();
      const wallet = createWalletStub();

      const result = await proto.sendToken.call(client, wallet, VALID_PRINCIPAL, token, 1);

      expect(result).toBe(`${VALID_CANISTER_ID}:7`);
    });

    it('wraps an Error thrown by transfer into a TxBroadcastError, preserving message and cause', async () => {
      const sendError = new Error('IC boundary node timeout');
      const transfer = jest.fn().mockRejectedValue(sendError);
      jest.spyOn(IcrcLedgerCanister, 'create').mockReturnValue({ transfer } as any);
      const client = createClientStub();
      const wallet = createWalletStub();

      let error: unknown;
      try {
        await proto.sendToken.call(client, wallet, VALID_PRINCIPAL, token, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('IC boundary node timeout');
      expect((error as TxBroadcastError).cause).toBe(sendError);
    });

    it('wraps a non-Error rejection from transfer into a TxBroadcastError via String(e)', async () => {
      const transfer = jest.fn().mockRejectedValue('reject-timeout');
      jest.spyOn(IcrcLedgerCanister, 'create').mockReturnValue({ transfer } as any);
      const client = createClientStub();
      const wallet = createWalletStub();

      let error: unknown;
      try {
        await proto.sendToken.call(client, wallet, VALID_PRINCIPAL, token, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('reject-timeout');
    });

    it('does not wrap a missing canister ID (pre-broadcast, plain error propagates unchanged)', async () => {
      const transfer = jest.fn();
      jest.spyOn(IcrcLedgerCanister, 'create').mockReturnValue({ transfer } as any);
      const client = createClientStub();
      const wallet = createWalletStub();
      const tokenWithoutChainId = createCustomAsset({ chainId: undefined, uniqueName: 'NO_CHAIN_ID' });

      let error: unknown;
      try {
        await proto.sendToken.call(client, wallet, VALID_PRINCIPAL, tokenWithoutChainId, 1);
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect((error as Error).message).toBe('No canister ID for token NO_CHAIN_ID');
      expect(transfer).not.toHaveBeenCalled();
    });

    it('does not wrap a failure from building the transfer request (pre-broadcast, plain error propagates unchanged)', async () => {
      const transfer = jest.fn();
      jest.spyOn(IcrcLedgerCanister, 'create').mockReturnValue({ transfer } as any);
      const client = createClientStub();
      const wallet = createWalletStub();

      let error: unknown;
      try {
        await proto.sendToken.call(client, wallet, 'not-a-valid-principal', token, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect(transfer).not.toHaveBeenCalled(); // broadcast never reached
    });
  });
});
