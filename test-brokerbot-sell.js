/**
 * E2E Test: BrokerBot Sell via EIP-7702
 *
 * Tests the full flow with real signatures:
 * 1. Sign up test user
 * 2. Set KYC data
 * 3. Create sell request
 * 4. Sign EIP-712 delegation + EIP-7702 authorization
 * 5. Confirm sell → atomic batch TX on Sepolia
 */

const { createWalletClient, http, createPublicClient } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { sepolia } = require('viem/chains');

const API_URL = 'http://localhost:3000/v1';
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ALCHEMY_KEY = 'LBoTdXKMuNSrRtZ9YSS1p';

const account = privateKeyToAccount(PRIVATE_KEY);
console.log('Test account:', account.address);

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok && res.status !== 409) {
    console.error(`${method} ${path} → ${res.status}:`, JSON.stringify(data, null, 2));
  }
  return { status: res.status, data };
}

async function main() {
  // 1. Sign message for auth
  console.log('\n=== 1. Signing auth message ===');
  const message = `By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_${account.address}`;
  const signature = await account.signMessage({ message });
  console.log('Signature:', signature.substring(0, 20) + '...');

  // 2. Sign up
  console.log('\n=== 2. Sign up ===');
  let { status, data: authData } = await api('POST', '/auth/signUp', {
    address: account.address,
    signature,
  });

  if (status === 409 || status === 403) {
    // Already exists, sign in
    console.log('User exists, signing in...');
    ({ data: authData } = await api('POST', '/auth/signIn', {
      address: account.address,
      signature,
    }));
  }

  const token = authData.accessToken;
  console.log('Token:', token ? token.substring(0, 30) + '...' : 'MISSING');
  if (!token) {
    console.error('Auth failed:', authData);
    return;
  }

  // 3. Set KYC data
  console.log('\n=== 3. Set KYC data ===');
  const kycResp = await api('PUT', '/userData', {
    accountType: 'Personal',
    firstname: 'Test',
    surname: 'Brokerbot',
    street: 'Bahnhofstrasse',
    houseNumber: '1',
    location: 'Zurich',
    zip: '8001',
    country: { id: 41 },
    phone: '+41791234567',
  }, token);
  console.log('KYC status:', kycResp.status);

  // 4. Create sell request
  console.log('\n=== 4. Create sell request ===');
  const sellResp = await api('PUT', '/realunit/sell', {
    iban: 'CH9300762011623852957',
    currency: 'CHF',
    amount: 1,
    asset: 'REALU',
  }, token);

  if (sellResp.status !== 200 && sellResp.status !== 201) {
    console.error('Sell request failed');
    return;
  }

  const sellData = sellResp.data;
  console.log('Request ID:', sellData.id);
  console.log('isValid:', sellData.isValid);
  console.log('Deposit address:', sellData.depositAddress);

  if (!sellData.eip7702) {
    console.error('No EIP-7702 data in response');
    return;
  }

  const eip7702 = sellData.eip7702;
  console.log('Relayer:', eip7702.relayerAddress);
  console.log('DelegationManager:', eip7702.delegationManagerAddress);
  console.log('Delegator contract:', eip7702.delegatorAddress);
  console.log('User nonce:', eip7702.userNonce);

  // 5. Sign EIP-712 Delegation
  console.log('\n=== 5. Sign EIP-712 delegation ===');
  const delegationSignature = await account.signTypedData({
    domain: eip7702.domain,
    types: eip7702.types,
    primaryType: 'Delegation',
    message: {
      ...eip7702.message,
      // Ensure salt is bigint
      salt: BigInt(eip7702.message.salt),
    },
  });
  console.log('Delegation sig:', delegationSignature.substring(0, 20) + '...');

  // 6. Sign EIP-7702 Authorization
  console.log('\n=== 6. Sign EIP-7702 authorization ===');
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(`https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  });

  // Get current nonce for user
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(`https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  });
  const nonce = await publicClient.getTransactionCount({ address: account.address });
  console.log('Current nonce:', nonce);

  const authorization = await walletClient.signAuthorization({
    contractAddress: eip7702.delegatorAddress,
    nonce,
  });
  console.log('Authorization signed:', {
    chainId: authorization.chainId,
    address: authorization.address,
    nonce: authorization.nonce,
    yParity: authorization.yParity,
    r: authorization.r?.substring(0, 20) + '...',
    s: authorization.s?.substring(0, 20) + '...',
  });

  // 7. Confirm sell
  console.log('\n=== 7. Confirm sell with real signatures ===');
  const confirmResp = await api('PUT', `/realunit/sell/${sellData.id}/confirm`, {
    eip7702: {
      delegation: {
        delegate: eip7702.relayerAddress,
        delegator: account.address,
        authority: eip7702.message.authority,
        salt: eip7702.message.salt.toString(),
        signature: delegationSignature,
      },
      authorization: {
        chainId: Number(authorization.chainId),
        address: authorization.address,
        nonce: Number(authorization.nonce),
        r: authorization.r,
        s: authorization.s,
        yParity: authorization.yParity,
      },
    },
  }, token);

  console.log('\n=== Result ===');
  console.log('Status:', confirmResp.status);
  console.log('Response:', JSON.stringify(confirmResp.data, null, 2));

  if (confirmResp.data.txHash) {
    console.log(`\nSepolia TX: https://sepolia.etherscan.io/tx/${confirmResp.data.txHash}`);

    // 8. Wait and check receipt
    console.log('\nWaiting 15s for confirmation...');
    await new Promise(r => setTimeout(r, 15000));

    const receipt = await publicClient.getTransactionReceipt({ hash: confirmResp.data.txHash });
    console.log('\n=== TX Receipt ===');
    console.log('Status:', receipt.status); // 'success' or 'reverted'
    console.log('Gas used:', receipt.gasUsed.toString());
    console.log('Block:', receipt.blockNumber.toString());
    console.log('Logs:', receipt.logs.length);

    if (receipt.logs.length > 0) {
      console.log('\nEvent logs:');
      receipt.logs.forEach((log, i) => {
        console.log(`  Log ${i}: address=${log.address}, topics=${log.topics.length}, data=${log.data.substring(0, 40)}...`);
      });
    }
  }
}

main().catch(console.error);
