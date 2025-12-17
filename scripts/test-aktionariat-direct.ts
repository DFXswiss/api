import { Wallet } from 'ethers';

// Use fixed seed for reproducible testing
const TEST_SEED = 'cabin dizzy cage drastic damp surge meadow example spatial already quiz walnut';
const wallet = Wallet.fromMnemonic(TEST_SEED);
console.log('Wallet Address:', wallet.address);
console.log('Seed:', TEST_SEED);

const AKTIONARIAT_URL = 'https://ext.aktionariat.com/realunit/registerUser';
const AKTIONARIAT_API_KEY = '4tCJwlDHxWvsfZaPqo01zn71re9jNFcX8iirIFB7ddfHeNvlTajlw0bIlN9KNwvY';

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

const today = '2025-12-17';  // Fixed date for reproducible testing

async function main() {
  // Message to sign (exactly as Aktionariat expects)
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

  console.log('\n=== Message to sign ===');
  console.log(JSON.stringify(message, null, 2));

  // Sign with EIP-712
  const signature = await wallet._signTypedData(domain, types, message);
  console.log('\n=== Signature ===');
  console.log(signature);

  // Payload to send (message + signature + lang)
  const payload = {
    ...message,
    signature,
    lang: 'DE',
  };

  console.log('\n=== Payload to Aktionariat ===');
  console.log(JSON.stringify(payload, null, 2));

  // Send to Aktionariat
  console.log('\n=== Calling Aktionariat API ===');
  const response = await fetch(AKTIONARIAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AKTIONARIAT_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const status = response.status;
  const data = await response.json().catch(() => response.text());

  console.log('Status:', status);
  console.log('Response:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
