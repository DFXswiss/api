import { Wallet } from 'ethers';

const TEST_SEED = 'cabin dizzy cage drastic damp surge meadow example spatial already quiz walnut';
const wallet = Wallet.fromMnemonic(TEST_SEED);

const AKTIONARIAT_URL = 'https://ext.aktionariat.com/realunit/registerUser';
const AKTIONARIAT_API_KEY = '4tCJwlDHxWvsfZaPqo01zn71re9jNFcX8iirIFB7ddfHeNvlTajlw0bIlN9KNwvY';

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

async function testDomain(name: string, domain: any, message: any) {
  console.log(`\n=== Testing Domain: ${name} ===`);
  console.log('Domain:', JSON.stringify(domain));

  const signature = await wallet._signTypedData(domain, types, message);
  console.log('Signature:', signature);

  const payload = {
    ...message,
    signature,
    lang: 'DE',
  };

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
    if (status === 200) {
      console.log('SUCCESS!');
    }
    console.log('Response:', JSON.stringify(data));
    return status === 200;
  } catch (e) {
    console.log('Error:', (e as Error).message);
    return false;
  }
}

async function main() {
  console.log('Wallet Address:', wallet.address);

  const baseMessage = {
    email: 'test-domain@dfx.swiss',
    name: 'Test Domain',
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

  // Test 1: Standard (documented)
  await testDomain('Standard (name + version)', {
    name: 'RealUnitUser',
    version: '1',
  }, { ...baseMessage, email: 'test-d1@dfx.swiss' });

  // Test 2: With chainId = 1 (Mainnet)
  await testDomain('With chainId=1 (Mainnet)', {
    name: 'RealUnitUser',
    version: '1',
    chainId: 1,
  }, { ...baseMessage, email: 'test-d2@dfx.swiss' });

  // Test 3: With chainId = 137 (Polygon)
  await testDomain('With chainId=137 (Polygon)', {
    name: 'RealUnitUser',
    version: '1',
    chainId: 137,
  }, { ...baseMessage, email: 'test-d3@dfx.swiss' });

  // Test 4: With chainId = 10 (Optimism)
  await testDomain('With chainId=10 (Optimism)', {
    name: 'RealUnitUser',
    version: '1',
    chainId: 10,
  }, { ...baseMessage, email: 'test-d4@dfx.swiss' });

  // Test 5: With chainId = 42161 (Arbitrum)
  await testDomain('With chainId=42161 (Arbitrum)', {
    name: 'RealUnitUser',
    version: '1',
    chainId: 42161,
  }, { ...baseMessage, email: 'test-d5@dfx.swiss' });

  // Test 6: With verifyingContract = zero address
  await testDomain('With verifyingContract=0x0', {
    name: 'RealUnitUser',
    version: '1',
    verifyingContract: '0x0000000000000000000000000000000000000000',
  }, { ...baseMessage, email: 'test-d6@dfx.swiss' });

  // Test 7: Different name casing
  await testDomain('Name: realunituser (lowercase)', {
    name: 'realunituser',
    version: '1',
  }, { ...baseMessage, email: 'test-d7@dfx.swiss' });

  // Test 8: Different name
  await testDomain('Name: RealUnit', {
    name: 'RealUnit',
    version: '1',
  }, { ...baseMessage, email: 'test-d8@dfx.swiss' });

  console.log('\n=== Done ===');
}

main().catch(console.error);
