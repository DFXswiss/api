import { ethers } from 'ethers';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export const CHAIN_NAMES = ['ethereum', 'optimism', 'arbitrum', 'polygon', 'base', 'bsc', 'gnosis', 'citrea'] as const;

export type ChainName = (typeof CHAIN_NAMES)[number];

export const CHAIN_TO_BLOCKCHAIN: Record<ChainName, Blockchain> = {
  ethereum: Blockchain.ETHEREUM,
  optimism: Blockchain.OPTIMISM,
  arbitrum: Blockchain.ARBITRUM,
  polygon: Blockchain.POLYGON,
  base: Blockchain.BASE,
  bsc: Blockchain.BINANCE_SMART_CHAIN,
  gnosis: Blockchain.GNOSIS,
  citrea: Blockchain.CITREA,
};

export const EXPLORERS: Partial<Record<Blockchain, string>> = {
  [Blockchain.ETHEREUM]: 'https://etherscan.io',
  [Blockchain.OPTIMISM]: 'https://optimistic.etherscan.io',
  [Blockchain.ARBITRUM]: 'https://arbiscan.io',
  [Blockchain.POLYGON]: 'https://polygonscan.com',
  [Blockchain.BASE]: 'https://basescan.org',
  [Blockchain.BINANCE_SMART_CHAIN]: 'https://bscscan.com',
  [Blockchain.GNOSIS]: 'https://gnosisscan.io',
  [Blockchain.CITREA]: 'https://citreascan.com',
};

// Safety margin on the estimated tx fee for native sweeps. Covers small
// gas-price drift between dry-run and execute, plus floating-point round-trips
// when the API converts ether-units back to wei.
export const SWEEP_FEE_SAFETY_FACTOR = 1.05;

export interface RefundOptions {
  chainName: ChainName;
  blockchain: Blockchain;
  accountIndex: number;
  asset: string; // 'native' | normalized lowercase contract address
  isNative: boolean;
  amountArg: string;
  sweepAll: boolean;
  explicitTo?: string;
  toSenderOfTx?: string;
  execute: boolean;
}

export interface RawArgs {
  [key: string]: string | boolean | undefined;
}

export function parseArgs(argv: string[]): RawArgs {
  const args: RawArgs = {};
  const knownFlags = new Set(['--execute', '-h', '--help']);
  const knownKeys = new Set(['--chain', '--account-index', '--asset', '--amount', '--to', '--to-sender-of']);

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--execute') {
      args.execute = true;
      continue;
    }
    if (a === '-h' || a === '--help') {
      args.help = true;
      continue;
    }

    if (!a.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${a}`);
    }
    if (!knownKeys.has(a) && !knownFlags.has(a)) {
      throw new Error(`Unknown flag: ${a}`);
    }

    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = val;
    i++;
  }
  return args;
}

export function validateArgs(args: RawArgs): RefundOptions {
  const chainName = args.chain;
  if (typeof chainName !== 'string' || !(CHAIN_NAMES as readonly string[]).includes(chainName)) {
    throw new Error(`Unknown --chain (have: ${CHAIN_NAMES.join(', ')})`);
  }

  const accountIndexRaw = args['account-index'];
  if (typeof accountIndexRaw !== 'string' || !/^\d+$/.test(accountIndexRaw)) {
    throw new Error('--account-index must be a non-negative integer');
  }

  const assetRaw = args.asset;
  if (typeof assetRaw !== 'string') throw new Error('--asset is required (native|<contract>)');
  const isNative = assetRaw === 'native';
  if (!isNative && !ethers.utils.isAddress(assetRaw)) {
    throw new Error('--asset must be "native" or a valid contract address');
  }
  // Normalize contract address to lowercase: asset.chainId is stored
  // lowercase in the database, while operators typically paste a checksum
  // address copied from a block-explorer.
  const asset = isNative ? 'native' : assetRaw.toLowerCase();

  const amountArg = args.amount;
  if (typeof amountArg !== 'string') throw new Error('--amount is required (all|<float>)');
  if (amountArg !== 'all' && !/^\d+(\.\d+)?$/.test(amountArg)) {
    throw new Error('--amount must be "all" or a positive number');
  }

  const explicitToRaw = args.to;
  const toSenderOfTxRaw = args['to-sender-of'];
  const explicitTo = typeof explicitToRaw === 'string' ? explicitToRaw : undefined;
  const toSenderOfTx = typeof toSenderOfTxRaw === 'string' ? toSenderOfTxRaw : undefined;

  if (!explicitTo && !toSenderOfTx) {
    throw new Error('Need --to <addr> OR --to-sender-of <txHash>');
  }
  if (explicitTo && toSenderOfTx) {
    throw new Error('--to and --to-sender-of are mutually exclusive');
  }
  if (explicitTo && !ethers.utils.isAddress(explicitTo)) {
    throw new Error('--to must be a valid address');
  }
  if (toSenderOfTx && !/^0x[0-9a-fA-F]{64}$/.test(toSenderOfTx)) {
    throw new Error('--to-sender-of must be a 32-byte hex tx hash');
  }

  return {
    chainName: chainName as ChainName,
    blockchain: CHAIN_TO_BLOCKCHAIN[chainName as ChainName],
    accountIndex: parseInt(accountIndexRaw, 10),
    asset,
    isNative,
    amountArg,
    sweepAll: amountArg === 'all',
    explicitTo,
    toSenderOfTx,
    execute: args.execute === true,
  };
}

export function helpText(): string {
  return `Refund / forward funds from a DFX EVM deposit address — LAST-RESORT TOOL.

Prefer PUT /support/crypto-input/:id/return for normal cases (it updates the
crypto_input record, lets the cron pipeline send and tracks confirmations).
Use this script only when the pipeline cannot process the record at all
(asset null, not confirmed, or no record exists).

Required:
  --chain <name>           ${CHAIN_NAMES.join(', ')}
  --account-index <N>      Deposit address slot (BIP-44 m/44'/60'/0'/0/N)
  --asset native|<addr>    'native' or ERC20 contract address
  --amount all|<float>     'all' to sweep everything

One of:
  --to <address>           Explicit recipient
  --to-sender-of <txHash>  Use the 'from' of that transaction as recipient

Optional:
  --execute                Broadcast (default: dry-run)
  -h, --help               This help
`;
}

// Compute the value to send when sweeping native balance.
// Returns the amount that, when sent as `value`, leaves enough native balance
// to cover the gas fee with the given safety margin.
export function computeNativeSweepAmount(nativeBalance: number, estimatedFee: number, safetyFactor: number): number {
  const reservedFee = estimatedFee * safetyFactor;
  const sendAmount = nativeBalance - reservedFee;
  if (sendAmount <= 0) {
    throw new Error(`Native balance ${nativeBalance} ≤ reserved fee ${reservedFee}`);
  }
  return sendAmount;
}
