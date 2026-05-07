#!/usr/bin/env node
//
// Refund / forward funds from a DFX EVM deposit address — LAST-RESORT TOOL.
//
// Prefer the support endpoint for normal refund cases:
//
//   PUT /support/crypto-input/:id/return
//   Body: { destinationAddress, chargebackAmount }
//
// That endpoint calls payInService.returnPayIn(), which sets the correct
// status/action on the crypto_input record and lets the existing send-strategy
// cron broadcast the tx, update returnTxId and track confirmations — full
// audit trail.
//
// This script bypasses all of that. Use it ONLY when a CryptoInput record
// cannot be processed by the pipeline at all (asset is null, not confirmed,
// or no record exists), and the funds need to come back without a clean
// audit trail. Bootstraps the NestJS application context and uses the existing
// BlockchainRegistryService + EvmClient to derive the deposit wallet
// (EVM_DEPOSIT_SEED + accountIndex) and forward a chosen asset to a chosen
// recipient. Recipient can be derived from a deposit transaction (sender of
// that tx).
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

const { ethers } = require('ethers');
const {
  parseArgs,
  validateArgs,
  helpText,
  computeNativeSweepAmount,
  EXPLORERS,
  SWEEP_FEE_SAFETY_FACTOR,
} = require('../dist/src/scripts/refund-deposit.util');

async function resolveRecipient(provider, opts) {
  if (opts.explicitTo) return ethers.utils.getAddress(opts.explicitTo);

  console.log(`\nResolving sender of tx ${opts.toSenderOfTx} ...`);
  const tx = await provider.getTransaction(opts.toSenderOfTx);
  if (!tx) throw new Error(`Transaction ${opts.toSenderOfTx} not found on ${opts.chainName}`);
  const sender = ethers.utils.getAddress(tx.from);
  console.log(`  → sender: ${sender}`);
  return sender;
}

async function resolveAsset(assetService, AssetType, opts) {
  if (opts.isNative) {
    const native = await assetService.getNativeAsset(opts.blockchain);
    if (!native) throw new Error(`No native asset configured for ${opts.blockchain}`);
    return native;
  }
  const token = await assetService.getAssetByChainId(opts.blockchain, opts.asset);
  if (!token) throw new Error(`No asset entity for contract ${opts.asset} on ${opts.blockchain}`);
  if (token.type !== AssetType.TOKEN) throw new Error(`Asset ${token.name} is not a TOKEN`);
  return token;
}

async function estimateNativeFee(provider, fromAddress, recipient, gasPrice) {
  // Use value=0 for the probe so providers that reject estimateGas with
  // value > balance don't fail — gas for a plain transfer is value-independent.
  const estimated = await provider.estimateGas({ from: fromAddress, to: recipient, value: 0 });
  return +ethers.utils.formatEther(estimated.mul(gasPrice));
}

async function estimateTokenFee(provider, fromAddress, contractAddress, recipient, amountWei, gasPrice) {
  const iface = new ethers.utils.Interface(['function transfer(address,uint256)']);
  const data = iface.encodeFunctionData('transfer', [recipient, amountWei]);
  const estimated = await provider.estimateGas({ from: fromAddress, to: contractAddress, data });
  return +ethers.utils.formatEther(estimated.mul(gasPrice));
}

async function main() {
  const rawArgs = parseArgs(process.argv);
  if (rawArgs.help) {
    console.log(helpText());
    return;
  }
  const opts = validateArgs(rawArgs);

  if (!process.env.EVM_DEPOSIT_SEED) {
    throw new Error('EVM_DEPOSIT_SEED env var is not set');
  }

  // Defer heavy NestJS / dist requires until args are validated, so --help and
  // input errors don't trigger application-context bootstrap.
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/src/app.module');
  const {
    BlockchainRegistryService,
  } = require('../dist/src/integration/blockchain/shared/services/blockchain-registry.service');
  const { AssetService } = require('../dist/src/shared/models/asset/asset.service');
  const { AssetType } = require('../dist/src/shared/models/asset/asset.entity');
  const { EvmUtil } = require('../dist/src/integration/blockchain/shared/evm/evm.util');
  const { GetConfig } = require('../dist/src/config/config');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const registry = app.get(BlockchainRegistryService);
    const assetService = app.get(AssetService);

    const client = registry.getEvmClient(opts.blockchain);
    const account = GetConfig().blockchain.evm.walletAccount(opts.accountIndex);
    const wallet = EvmUtil.createWallet(account);
    const fromAddress = wallet.address;

    console.log('=== DFX Deposit Refund ===');
    console.log(`Chain:           ${opts.chainName} (${opts.blockchain})`);
    console.log(`Account index:   ${opts.accountIndex}`);
    console.log(`Deposit address: ${fromAddress}`);

    const recipient = await resolveRecipient(client.provider, opts);
    if (recipient.toLowerCase() === fromAddress.toLowerCase()) {
      throw new Error('Refusing to send to deposit address itself');
    }
    console.log(`Recipient:       ${recipient}`);

    const asset = await resolveAsset(assetService, AssetType, opts);
    const gasPrice = await client.getRecommendedGasPrice();
    const nativeBalance = await client.getNativeCoinBalanceForAddress(fromAddress);

    let sendAmount;
    let fee;
    if (opts.isNative) {
      if (nativeBalance <= 0) throw new Error(`Native balance is 0 ${asset.name}`);
      fee = await estimateNativeFee(client.provider, fromAddress, recipient, gasPrice);
      if (opts.sweepAll) {
        sendAmount = computeNativeSweepAmount(nativeBalance, fee, SWEEP_FEE_SAFETY_FACTOR);
      } else {
        sendAmount = parseFloat(opts.amountArg);
        if (sendAmount + fee > nativeBalance) {
          throw new Error(`Need ${sendAmount + fee} ${asset.name}, have ${nativeBalance} ${asset.name}`);
        }
      }
      console.log(`\nNative balance:  ${nativeBalance} ${asset.name}`);
      console.log(`Estimated fee:   ${fee} ${asset.name}`);
    } else {
      const tokenBalance = await client.getTokenBalance(asset, fromAddress);
      if (tokenBalance <= 0) throw new Error(`Token balance is 0 for ${asset.name}`);

      sendAmount = opts.sweepAll ? tokenBalance : parseFloat(opts.amountArg);
      if (sendAmount > tokenBalance) {
        throw new Error(`Need ${sendAmount} ${asset.name}, have ${tokenBalance} ${asset.name}`);
      }

      const amountWei = ethers.utils.parseUnits(sendAmount.toString(), asset.decimals);
      fee = await estimateTokenFee(client.provider, fromAddress, asset.chainId, recipient, amountWei, gasPrice);
      if (fee > nativeBalance) {
        throw new Error(`Estimated gas fee ${fee} exceeds native balance ${nativeBalance} — fund the deposit address first`);
      }

      console.log(`\nToken balance:   ${tokenBalance} ${asset.name}`);
      console.log(`Native balance:  ${nativeBalance} (for gas)`);
      console.log(`Estimated fee:   ${fee}`);
    }

    console.log('\n--- Plan ---');
    console.log(`Send ${sendAmount} ${asset.name} from ${fromAddress} to ${recipient}`);

    if (!opts.execute) {
      console.log('\nDRY RUN — pass --execute to broadcast.');
      return;
    }

    console.log('\nBroadcasting...');
    const txHash = opts.isNative
      ? await client.sendNativeCoinFromAccount(account, recipient, sendAmount)
      : await client.sendTokenFromAccount(account, recipient, asset, sendAmount);

    const explorer = EXPLORERS[opts.blockchain];
    console.log(`Tx hash:         ${txHash}`);
    if (explorer) console.log(`Explorer:        ${explorer}/tx/${txHash}`);
    console.log('Waiting for 1 confirmation...');
    const receipt = await client.provider.waitForTransaction(txHash, 1);
    console.log(`Confirmed in block ${receipt.blockNumber}, status=${receipt.status === 1 ? 'OK' : 'FAILED'}`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`\nERROR: ${e.message}`);
    process.exit(1);
  });
}
