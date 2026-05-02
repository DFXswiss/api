#!/usr/bin/env node
/* eslint-disable */
//
// Refund / forward funds from a DFX EVM deposit address.
//
// Derives the deposit wallet from EVM_DEPOSIT_SEED + accountIndex (BIP-44 path
// m/44'/60'/0'/0/<accountIndex>, same as EvmUtil.getPathFor), then sends a
// chosen asset to a chosen recipient. Recipient can be derived from a deposit
// transaction (sender of that tx).
//
// Default behaviour is DRY-RUN. Pass --execute to broadcast.
//
// Where to run:
//   The deposit seed only lives in the api container env. On prd this is the
//   Azure App Service `app-dfx-api-prd`. SSH in and run from /home/site/wwwroot:
//
//     az webapp ssh -g <rg> -n app-dfx-api-prd
//     cd /home/site/wwwroot
//     node scripts/refund-deposit.js --help
//
// Usage:
//   node scripts/refund-deposit.js \
//     --chain citrea \
//     --account-index 4486 \
//     --asset native \
//     --amount all \
//     --to-sender-of 0x8b3bbec3... \
//     [--execute]
//
//   node scripts/refund-deposit.js \
//     --chain ethereum \
//     --account-index 4486 \
//     --asset 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
//     --amount 100 \
//     --to 0xRECIPIENT \
//     [--execute]
//
// Required env: EVM_DEPOSIT_SEED, ALCHEMY_API_KEY (for Alchemy-backed chains).
//

const { ethers } = require('ethers');
const { defaultPath } = require('ethers/lib/utils');

const CHAINS = {
  ethereum: { id: 1,     rpc: 'https://eth-mainnet.g.alchemy.com/v2',     useAlchemyKey: true,  explorer: 'https://etherscan.io',             nativeSymbol: 'ETH' },
  optimism: { id: 10,    rpc: 'https://opt-mainnet.g.alchemy.com/v2',     useAlchemyKey: true,  explorer: 'https://optimistic.etherscan.io',  nativeSymbol: 'ETH' },
  arbitrum: { id: 42161, rpc: 'https://arb-mainnet.g.alchemy.com/v2',     useAlchemyKey: true,  explorer: 'https://arbiscan.io',              nativeSymbol: 'ETH' },
  polygon:  { id: 137,   rpc: 'https://polygon-mainnet.g.alchemy.com/v2', useAlchemyKey: true,  explorer: 'https://polygonscan.com',          nativeSymbol: 'POL' },
  base:     { id: 8453,  rpc: 'https://base-mainnet.g.alchemy.com/v2',    useAlchemyKey: true,  explorer: 'https://basescan.org',             nativeSymbol: 'ETH' },
  bsc:      { id: 56,    rpc: 'https://bnb-mainnet.g.alchemy.com/v2',     useAlchemyKey: true,  explorer: 'https://bscscan.com',              nativeSymbol: 'BNB' },
  gnosis:   { id: 100,   rpc: 'https://gnosis-mainnet.g.alchemy.com/v2',  useAlchemyKey: true,  explorer: 'https://gnosisscan.io',            nativeSymbol: 'xDAI' },
  citrea:   { id: 4114,  rpc: 'https://rpc.citreascan.com',               useAlchemyKey: false, explorer: 'https://citreascan.com',           nativeSymbol: 'cBTC' },
};

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') { args.execute = true; continue; }
    if (a === '-h' || a === '--help') { args.help = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = val;
      i++;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Refund / forward funds from a DFX EVM deposit address.

Required:
  --chain <name>           ${Object.keys(CHAINS).join(', ')}
  --account-index <N>      Deposit address slot (BIP-44 m/44'/60'/0'/0/N)
  --asset native|<addr>    'native' or ERC20 contract address
  --amount all|<float>     'all' to sweep everything

One of:
  --to <address>           Explicit recipient
  --to-sender-of <txHash>  Use the 'from' of that transaction as recipient

Optional:
  --execute                Broadcast (default: dry-run)
  -h, --help               This help

Required env:
  EVM_DEPOSIT_SEED         BIP-39 mnemonic for deposit HD wallet
  ALCHEMY_API_KEY          For Alchemy-backed chains
`);
}

function getPathFor(accountIndex) {
  const components = defaultPath.split('/');
  components[components.length - 1] = String(accountIndex);
  return components.join('/');
}

function buildRpcUrl(chain) {
  if (!chain.useAlchemyKey) return chain.rpc;
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error('ALCHEMY_API_KEY is required for this chain');
  return `${chain.rpc}/${key}`;
}

function fmt(amount, decimals, symbol) {
  return `${ethers.utils.formatUnits(amount, decimals)} ${symbol}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return; }

  // --- Validate args ---
  const chainName = args.chain;
  const chain = CHAINS[chainName];
  if (!chain) throw new Error(`Unknown --chain (have: ${Object.keys(CHAINS).join(', ')})`);

  const accountIndex = args['account-index'];
  if (accountIndex == null || !/^\d+$/.test(accountIndex)) {
    throw new Error('--account-index must be a non-negative integer');
  }

  const asset = args.asset;
  if (!asset) throw new Error('--asset is required (native|<contract>)');
  const isNative = asset === 'native';
  if (!isNative && !ethers.utils.isAddress(asset)) {
    throw new Error('--asset must be "native" or a valid contract address');
  }

  const amountArg = args.amount;
  if (!amountArg) throw new Error('--amount is required (all|<float>)');
  const sweepAll = amountArg === 'all';

  const explicitTo = args.to;
  const toSenderOfTx = args['to-sender-of'];
  if (!explicitTo && !toSenderOfTx) {
    throw new Error('Need --to <addr> OR --to-sender-of <txHash>');
  }
  if (explicitTo && toSenderOfTx) {
    throw new Error('--to and --to-sender-of are mutually exclusive');
  }
  if (explicitTo && !ethers.utils.isAddress(explicitTo)) {
    throw new Error('--to must be a valid address');
  }

  const seed = process.env.EVM_DEPOSIT_SEED;
  if (!seed) throw new Error('EVM_DEPOSIT_SEED env var is not set');

  // --- Build provider + wallet ---
  const provider = new ethers.providers.StaticJsonRpcProvider(buildRpcUrl(chain), chain.id);
  const wallet = ethers.Wallet.fromMnemonic(seed, getPathFor(accountIndex)).connect(provider);
  const fromAddress = wallet.address;
  const nativeSymbol = chain.nativeSymbol;

  console.log('=== DFX Deposit Refund ===');
  console.log(`Chain:           ${chainName} (chainId ${chain.id})`);
  console.log(`Account index:   ${accountIndex}`);
  console.log(`Deposit address: ${fromAddress}`);

  // --- Resolve recipient ---
  let to;
  if (explicitTo) {
    to = ethers.utils.getAddress(explicitTo);
  } else {
    console.log(`\nResolving sender of tx ${toSenderOfTx} ...`);
    const tx = await provider.getTransaction(toSenderOfTx);
    if (!tx) throw new Error(`Transaction ${toSenderOfTx} not found on ${chainName}`);
    to = ethers.utils.getAddress(tx.from);
    console.log(`  → sender: ${to}`);
  }
  if (to.toLowerCase() === fromAddress.toLowerCase()) {
    throw new Error('Refusing to send to deposit address itself');
  }
  console.log(`Recipient:       ${to}`);

  // --- Build transaction ---
  const gasPrice = await provider.getGasPrice();
  const nativeBalance = await provider.getBalance(fromAddress);

  let txReq;
  let display; // { decimals, symbol }
  let sendAmount;
  let gasLimit;

  if (isNative) {
    if (nativeBalance.isZero()) throw new Error(`Native balance is 0 ${nativeSymbol}`);

    let value;
    if (sweepAll) {
      // estimate first with full balance as value (will revert if balance == 0, handled above)
      const estimated = await provider.estimateGas({ to, value: nativeBalance, from: fromAddress });
      gasLimit = estimated.mul(120).div(100);
      const fee = gasLimit.mul(gasPrice);
      value = nativeBalance.sub(fee);
      if (value.lte(0)) throw new Error(`Native balance ${fmt(nativeBalance, 18, nativeSymbol)} ≤ tx fee ${fmt(fee, 18, nativeSymbol)}`);
    } else {
      value = ethers.utils.parseEther(amountArg);
      const estimated = await provider.estimateGas({ to, value, from: fromAddress });
      gasLimit = estimated.mul(120).div(100);
      const fee = gasLimit.mul(gasPrice);
      if (value.add(fee).gt(nativeBalance)) {
        throw new Error(`Need ${fmt(value.add(fee), 18, nativeSymbol)}, have ${fmt(nativeBalance, 18, nativeSymbol)}`);
      }
    }
    txReq = { to, value, gasLimit, gasPrice };
    display = { decimals: 18, symbol: nativeSymbol };
    sendAmount = value;
    console.log(`\nNative balance:  ${fmt(nativeBalance, 18, nativeSymbol)}`);
  } else {
    const token = new ethers.Contract(asset, ERC20_ABI, wallet);
    const [decimals, symbol, tokenBalance] = await Promise.all([
      token.decimals(),
      token.symbol(),
      token.balanceOf(fromAddress),
    ]);
    if (tokenBalance.isZero()) throw new Error(`Token balance is 0 for ${symbol} (${asset})`);

    const amount = sweepAll ? tokenBalance : ethers.utils.parseUnits(amountArg, decimals);
    if (amount.gt(tokenBalance)) {
      throw new Error(`Need ${fmt(amount, decimals, symbol)}, have ${fmt(tokenBalance, decimals, symbol)}`);
    }

    const populated = await token.populateTransaction.transfer(to, amount);
    const estimated = await provider.estimateGas({ ...populated, from: fromAddress });
    gasLimit = estimated.mul(120).div(100);
    const fee = gasLimit.mul(gasPrice);
    if (fee.gt(nativeBalance)) {
      throw new Error(`Gas fee ${fmt(fee, 18, nativeSymbol)} exceeds native balance ${fmt(nativeBalance, 18, nativeSymbol)}`);
    }
    txReq = { ...populated, gasLimit, gasPrice };
    display = { decimals, symbol };
    sendAmount = amount;
    console.log(`\nToken balance:   ${fmt(tokenBalance, decimals, symbol)}`);
    console.log(`Native balance:  ${fmt(nativeBalance, 18, nativeSymbol)} (for gas)`);
  }

  const fee = gasLimit.mul(gasPrice);
  console.log(`Gas price:       ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
  console.log(`Gas limit:       ${gasLimit.toString()}`);
  console.log(`Estimated fee:   ${fmt(fee, 18, nativeSymbol)}`);

  console.log('\n--- Plan ---');
  console.log(`Send ${fmt(sendAmount, display.decimals, display.symbol)} from ${fromAddress} to ${to}`);

  if (!args.execute) {
    console.log('\nDRY RUN — pass --execute to broadcast.');
    return;
  }

  // --- Broadcast ---
  console.log('\nBroadcasting...');
  const sent = await wallet.sendTransaction(txReq);
  console.log(`Tx hash:         ${sent.hash}`);
  console.log(`Explorer:        ${chain.explorer}/tx/${sent.hash}`);
  console.log('Waiting for 1 confirmation...');
  const receipt = await sent.wait(1);
  console.log(`Confirmed in block ${receipt.blockNumber}, status=${receipt.status === 1 ? 'OK' : 'FAILED'}`);
}

main().catch((e) => {
  console.error(`\nERROR: ${e.message}`);
  process.exit(1);
});
