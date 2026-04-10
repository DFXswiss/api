/**
 * Starknet Account Deployment Script
 *
 * Deploys an OpenZeppelin Account Contract on Starknet.
 * Every Starknet account is a smart contract (native account abstraction).
 *
 * Usage:
 *   npx ts-node scripts/deploy-starknet-account.ts [--generate | --deploy]
 *
 * Modes:
 *   --generate   Generate a new key pair and compute the account address
 *   --deploy     Deploy the account contract (requires funded address)
 *
 * Environment variables (for --deploy):
 *   STARKNET_GATEWAY_URL        RPC endpoint (e.g. Alchemy, Infura)
 *   STARKNET_WALLET_PRIVATE_KEY Private key (hex, from --generate step)
 */

import { Account, RpcProvider, CallData, ec, hash } from 'starknet';

// OpenZeppelin Account v0.8.1 class hash on Starknet mainnet
// Widely used, declared on mainnet, verified via starknet.js docs
// https://starknetjs.com/docs/6.24.1/guides/create_account
const OZ_ACCOUNT_CLASS_HASH = '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f';

async function generateKeys() {
  // Generate random private key
  const privateKey = '0x' + Buffer.from(ec.starkCurve.utils.randomPrivateKey()).toString('hex');
  const publicKey = ec.starkCurve.getStarkKey(privateKey);

  // Compute counterfactual address
  const constructorCalldata = CallData.compile({ publicKey });
  const address = hash.calculateContractAddressFromHash(publicKey, OZ_ACCOUNT_CLASS_HASH, constructorCalldata, 0);

  console.log('=== Starknet Account Generated ===\n');
  console.log('Private Key:', privateKey);
  console.log('Public Key: ', publicKey);
  console.log('Address:    ', address);
  console.log('\n=== Next Steps ===\n');
  console.log('1. Add to .env:');
  console.log(`   STARKNET_WALLET_PRIVATE_KEY=${privateKey}`);
  console.log(`   STARKNET_WALLET_ADDRESS=${address}`);
  console.log('\n2. Send STRK to the address above (for gas fees, ~0.001 STRK)');
  console.log('\n3. Run: npx ts-node scripts/deploy-starknet-account.ts --deploy');
}

async function deployAccount() {
  const gatewayUrl = process.env.STARKNET_GATEWAY_URL;
  const privateKey = process.env.STARKNET_WALLET_PRIVATE_KEY;

  if (!gatewayUrl || !privateKey) {
    console.error('Missing environment variables: STARKNET_GATEWAY_URL, STARKNET_WALLET_PRIVATE_KEY');
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: gatewayUrl });
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const constructorCalldata = CallData.compile({ publicKey });

  const address = hash.calculateContractAddressFromHash(publicKey, OZ_ACCOUNT_CLASS_HASH, constructorCalldata, 0);

  console.log('Deploying account at:', address);

  // Check balance before deployment
  const account = new Account({ provider, address, signer: privateKey });

  try {
    const nonce = await account.getNonce();
    if (BigInt(nonce) > 0n) {
      console.log('Account already deployed (nonce > 0). Nothing to do.');
      return;
    }
  } catch {
    // getNonce fails if account not deployed yet — expected
  }

  console.log('Sending DEPLOY_ACCOUNT transaction...');

  const deployResponse = await account.deployAccount({
    classHash: OZ_ACCOUNT_CLASS_HASH,
    constructorCalldata,
    addressSalt: publicKey,
  });

  console.log('Transaction hash:', deployResponse.transaction_hash);
  console.log('Waiting for confirmation...');

  await provider.waitForTransaction(deployResponse.transaction_hash);

  console.log('\n=== Account Deployed Successfully ===');
  console.log('Address:', deployResponse.contract_address?.[0] ?? address);
}

async function main() {
  const mode = process.argv[2];

  switch (mode) {
    case '--generate':
      await generateKeys();
      break;
    case '--deploy':
      await deployAccount();
      break;
    default:
      console.log('Usage: npx ts-node scripts/deploy-starknet-account.ts [--generate | --deploy]');
      console.log('');
      console.log('  --generate   Generate key pair and compute account address');
      console.log('  --deploy     Deploy account contract (requires funded address)');
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
