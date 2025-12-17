import { Wallet } from 'ethers';
import { splitSignature } from 'ethers/lib/utils';

const TEST_SEED = 'cabin dizzy cage drastic damp surge meadow example spatial already quiz walnut';
const wallet = Wallet.fromMnemonic(TEST_SEED);

const AKTIONARIAT_URL = 'https://ext.aktionariat.com/realunit/registerUser';
const AKTIONARIAT_API_KEY = '4tCJwlDHxWvsfZaPqo01zn71re9jNFcX8iirIFB7ddfHeNvlTajlw0bIlN9KNwvY';

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

async function testVariation(name: string, payload: any) {
  console.log(`\n=== Testing: ${name} ===`);
  try {
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
    console.log('Response:', JSON.stringify(data));
    return status === 200;
  } catch (e) {
    console.log('Error:', (e as Error).message);
    return false;
  }
}

async function main() {
  console.log('Wallet Address:', wallet.address);

  // Base message
  const baseMessage = {
    email: 'test-var@dfx.swiss',
    name: 'Test Variation',
    type: 'HUMAN',
    phoneNumber: '+41791234567',
    birthday: '1990-01-15',
    nationality: 'CH',
    addressStreet: 'Teststrasse 1',
    addressPostalCode: '8000',
    addressCity: 'Zurich',
    addressCountry: 'CH',
    swissTaxResidence: true,
    registrationDate: '2025-12-17',
    walletAddress: wallet.address,
  };

  // Sign the base message
  const signature = await wallet._signTypedData(domain, types, baseMessage);
  const split = splitSignature(signature);

  console.log('\nBase Signature:', signature);
  console.log('v:', split.v, '| recoveryParam:', split.recoveryParam);

  // Test 1: Standard (baseline)
  await testVariation('Standard', {
    ...baseMessage,
    signature,
    lang: 'DE',
  });

  // Test 2: Lowercase wallet address in payload (but signed with checksum)
  await testVariation('Lowercase walletAddress in payload', {
    ...baseMessage,
    walletAddress: wallet.address.toLowerCase(),
    signature,
    lang: 'DE',
  });

  // Test 3: Signature without 0x prefix
  await testVariation('Signature without 0x', {
    ...baseMessage,
    signature: signature.slice(2),
    lang: 'DE',
  });

  // Test 4: Signature with v=0/1 instead of 27/28
  const altV = split.v - 27;
  const altSig = split.r + split.s.slice(2) + altV.toString(16).padStart(2, '0');
  await testVariation('Signature with v=0/1', {
    ...baseMessage,
    signature: altSig,
    lang: 'DE',
  });

  // Test 5: With empty countryAndTINs array
  await testVariation('With countryAndTINs: []', {
    ...baseMessage,
    signature,
    lang: 'DE',
    countryAndTINs: [],
  });

  // Test 6: With countryAndTINs: null
  await testVariation('With countryAndTINs: null', {
    ...baseMessage,
    signature,
    lang: 'DE',
    countryAndTINs: null,
  });

  // Test 7: Sign with lowercase address
  console.log('\n=== Signing with lowercase address ===');
  const lowercaseMessage = {
    ...baseMessage,
    email: 'test-lower@dfx.swiss',
    walletAddress: wallet.address.toLowerCase(),
  };
  const lowercaseSig = await wallet._signTypedData(domain, types, lowercaseMessage);
  await testVariation('Signed with lowercase address', {
    ...lowercaseMessage,
    signature: lowercaseSig,
    lang: 'DE',
  });

  // Test 8: Use Aktionariat's exact example data format
  console.log('\n=== Using Aktionariat example format ===');
  const aktionariatMessage = {
    email: 'test-akt@dfx.swiss',
    name: 'Murat Ogat', // Without umlaut to avoid encoding issues
    type: 'HUMAN',
    phoneNumber: '+41791234567',
    birthday: '1990-01-01',
    nationality: 'CH',
    addressStreet: 'Bahnhofstrasse 1',
    addressPostalCode: '8001',
    addressCity: 'Zurich', // Without umlaut
    addressCountry: 'CH',
    swissTaxResidence: true,
    registrationDate: '2025-12-01',
    walletAddress: wallet.address,
  };
  const aktSig = await wallet._signTypedData(domain, types, aktionariatMessage);
  await testVariation('Aktionariat example format', {
    ...aktionariatMessage,
    signature: aktSig,
    lang: 'DE',
  });

  // Test 9: Compact signature (64 bytes)
  await testVariation('Compact signature (64 bytes)', {
    ...baseMessage,
    signature: split.compact,
    lang: 'DE',
  });

  console.log('\n=== Done ===');
}

main().catch(console.error);
