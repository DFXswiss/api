import { Wallet } from 'ethers';

// Use a fixed seed for reproducible testing
const TEST_SEED = 'cabin dizzy cage drastic damp surge meadow example spatial already quiz walnut';
const wallet = Wallet.fromPhrase(TEST_SEED);

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

console.log('\n=== Signing with ethers v6 ===');
const signature = await wallet.signTypedData(domain, types, message);
console.log('Signature (v6):', signature);

// Compare with v5 signature
console.log('\n=== Expected v5 signature ===');
console.log('0x9196c073b4f0c8a6e386b21a53fee91cb16299624226c7155266af46aacfac7a7451f29178de1c5f71992872dca5a6a917c3557d78a456fefe15d58d9cd012571b');
console.log('Same:', signature === '0x9196c073b4f0c8a6e386b21a53fee91cb16299624226c7155266af46aacfac7a7451f29178de1c5f71992872dca5a6a917c3557d78a456fefe15d58d9cd012571b');
