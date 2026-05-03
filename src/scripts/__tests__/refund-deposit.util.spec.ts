import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  CHAIN_NAMES,
  CHAIN_TO_BLOCKCHAIN,
  computeNativeSweepAmount,
  EXPLORERS,
  parseArgs,
  SWEEP_FEE_SAFETY_FACTOR,
  validateArgs,
} from '../refund-deposit.util';

const baseArgv = (extra: string[]) => ['node', 'refund-deposit.js', ...extra];

describe('refund-deposit.util', () => {
  describe('parseArgs', () => {
    it('parses key/value flags and the --execute switch', () => {
      const args = parseArgs(
        baseArgv([
          '--chain',
          'citrea',
          '--account-index',
          '4486',
          '--asset',
          'native',
          '--amount',
          'all',
          '--to',
          '0xB2CBBde7cfDb5ea1DB27aCcdd1abf7EE3BcC87C1',
          '--execute',
        ]),
      );
      expect(args).toEqual({
        chain: 'citrea',
        'account-index': '4486',
        asset: 'native',
        amount: 'all',
        to: '0xB2CBBde7cfDb5ea1DB27aCcdd1abf7EE3BcC87C1',
        execute: true,
      });
    });

    it('recognises -h and --help', () => {
      expect(parseArgs(baseArgv(['-h']))).toEqual({ help: true });
      expect(parseArgs(baseArgv(['--help']))).toEqual({ help: true });
    });

    it('throws on unknown flags', () => {
      expect(() => parseArgs(baseArgv(['--chian', 'ethereum']))).toThrow(/Unknown flag/);
    });

    it('throws on positional arguments', () => {
      expect(() => parseArgs(baseArgv(['ethereum']))).toThrow(/Unexpected positional argument/);
    });

    it('throws when a value is missing', () => {
      expect(() => parseArgs(baseArgv(['--chain']))).toThrow(/Missing value for --chain/);
      expect(() => parseArgs(baseArgv(['--chain', '--asset', 'native']))).toThrow(/Missing value for --chain/);
    });
  });

  describe('validateArgs', () => {
    const validBase = {
      chain: 'citrea',
      'account-index': '4486',
      asset: 'native',
      amount: 'all',
      to: '0xB2CBBde7cfDb5ea1DB27aCcdd1abf7EE3BcC87C1',
    };

    it('returns a fully resolved option set for the happy path', () => {
      const opts = validateArgs(validBase);
      expect(opts).toEqual({
        chainName: 'citrea',
        blockchain: Blockchain.CITREA,
        accountIndex: 4486,
        asset: 'native',
        isNative: true,
        amountArg: 'all',
        sweepAll: true,
        explicitTo: '0xB2CBBde7cfDb5ea1DB27aCcdd1abf7EE3BcC87C1',
        toSenderOfTx: undefined,
        execute: false,
      });
    });

    it('lowercases the contract address before storage', () => {
      const opts = validateArgs({
        ...validBase,
        asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // checksum form
      });
      expect(opts.isNative).toBe(false);
      expect(opts.asset).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    });

    it('rejects unknown chains', () => {
      expect(() => validateArgs({ ...validBase, chain: 'monad' })).toThrow(/Unknown --chain/);
    });

    it('rejects non-numeric account indexes', () => {
      expect(() => validateArgs({ ...validBase, 'account-index': '4486x' })).toThrow(/account-index/);
      expect(() => validateArgs({ ...validBase, 'account-index': '-1' })).toThrow(/account-index/);
    });

    it('rejects an asset that is neither "native" nor a valid address', () => {
      expect(() => validateArgs({ ...validBase, asset: 'usdc' })).toThrow(/--asset must be/);
      expect(() => validateArgs({ ...validBase, asset: '0xnotvalid' })).toThrow(/--asset must be/);
    });

    it('rejects an amount that is not "all" or a positive number', () => {
      expect(() => validateArgs({ ...validBase, amount: 'half' })).toThrow(/--amount/);
      expect(() => validateArgs({ ...validBase, amount: '-1' })).toThrow(/--amount/);
    });

    it('requires exactly one of --to or --to-sender-of', () => {
      const { to: _to, ...withoutTo } = validBase;
      expect(() => validateArgs(withoutTo)).toThrow(/--to <addr> OR --to-sender-of/);
      expect(() =>
        validateArgs({
          ...validBase,
          'to-sender-of': '0x' + '0'.repeat(64),
        }),
      ).toThrow(/mutually exclusive/);
    });

    it('rejects an invalid recipient address', () => {
      expect(() => validateArgs({ ...validBase, to: '0xnotvalid' })).toThrow(/--to must be a valid/);
    });

    it('rejects a malformed tx hash for --to-sender-of', () => {
      const { to: _to, ...rest } = validBase;
      expect(() => validateArgs({ ...rest, 'to-sender-of': '0xabc' })).toThrow(/32-byte hex tx hash/);
    });

    it('passes an execute=true flag through', () => {
      expect(validateArgs({ ...validBase, execute: true }).execute).toBe(true);
    });
  });

  describe('computeNativeSweepAmount', () => {
    it('subtracts the safety-buffered fee from the balance', () => {
      const balance = 1.0;
      const fee = 0.001;
      const sendAmount = computeNativeSweepAmount(balance, fee, SWEEP_FEE_SAFETY_FACTOR);
      expect(sendAmount).toBeCloseTo(balance - fee * SWEEP_FEE_SAFETY_FACTOR, 12);
    });

    it('throws when the fee exceeds the balance', () => {
      expect(() => computeNativeSweepAmount(0.0001, 0.0002, SWEEP_FEE_SAFETY_FACTOR)).toThrow(/≤ reserved fee/);
    });

    it('honours a custom safety factor', () => {
      const sendAmount = computeNativeSweepAmount(1.0, 0.01, 1.5);
      expect(sendAmount).toBeCloseTo(1.0 - 0.015, 12);
    });
  });

  describe('CHAIN_TO_BLOCKCHAIN / EXPLORERS', () => {
    it('covers every CHAIN_NAME with a Blockchain mapping', () => {
      for (const name of CHAIN_NAMES) {
        expect(CHAIN_TO_BLOCKCHAIN[name]).toBeDefined();
      }
    });

    it('covers every mapped Blockchain with an explorer URL', () => {
      for (const blockchain of Object.values(CHAIN_TO_BLOCKCHAIN)) {
        expect(EXPLORERS[blockchain]).toMatch(/^https:\/\//);
      }
    });
  });
});
