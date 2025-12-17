import { Wallet } from 'ethers';
import { verifyTypedData } from 'ethers/lib/utils';

// Use a fixed seed for reproducible testing
const TEST_SEED = 'cabin dizzy cage drastic damp surge meadow example spatial already quiz walnut';
const wallet = Wallet.fromMnemonic(TEST_SEED);

console.log('Wallet Address:', wallet.address);

// EIP-712 Domain and Types (from Aktionariat spec)
const domain = {
  name: 'RealUnitUser',
  version: '1',
};

const types = {
  RealUnitUserRegistration: [
    { name: 'email', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'phoneNumber', type: 'string' },
    { name: 'birthday', type: 'string' },
    { name: 'nationality', type: 'string' },
    { name: 'addressStreet', type: 'string' },
    { name: 'addressPostalCode', type: 'string' },
    { name: 'addressCity', type: 'string' },
    { name: 'addressCountry', type: 'string' },
    { name: 'swissTaxResidence', type: 'bool' },
    { name: 'registrationDate', type: 'string' },
    { name: 'walletAddress', type: 'address' },
  ],
};

const today = new Date().toISOString().split('T')[0];

const message = {
  email: 'test-direct@dfx.swiss',
  name: 'Test Direct',
  type: 'HUMAN',
  phoneNumber: '+41791234567',
  birthday: '1990-01-15',
  nationality: 'CH',
  addressStreet: 'Teststrasse 1',
  addressPostalCode: '8000',
  addressCity: 'Zurich',
  addressCountry: 'CH',
  swissTaxResidence: true,
  registrationDate: today,
  walletAddress: wallet.address,
};

async function main() {
  console.log('\n=== Signing ===');
  const signature = await wallet._signTypedData(domain, types, message);
  console.log('Signature:', signature);

  console.log('\n=== Verifying locally ===');
  const recoveredAddress = verifyTypedData(domain, types, message, signature);
  console.log('Recovered Address:', recoveredAddress);
  console.log('Expected Address:', wallet.address);
  console.log('Match:', recoveredAddress.toLowerCase() === wallet.address.toLowerCase());

  // Try with EIP712Domain explicitly included (some implementations need this)
  console.log('\n=== Testing with explicit EIP712Domain ===');
  const typesWithDomain = {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
    ],
    ...types,
  };

  try {
    const signature2 = await wallet._signTypedData(domain, typesWithDomain, message);
    console.log('Signature with EIP712Domain:', signature2);
    console.log('Same as before:', signature === signature2);
  } catch (e) {
    console.log('Error with EIP712Domain:', e.message);
  }

  // Check ethers version
  console.log('\n=== Ethers Version ===');
  const ethers = require('ethers');
  console.log('Version:', ethers.version);
}

main().catch(console.error);
