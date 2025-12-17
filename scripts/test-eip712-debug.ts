import { Wallet } from 'ethers';
import { _TypedDataEncoder, verifyTypedData } from 'ethers/lib/utils';
import { keccak256, toUtf8Bytes, defaultAbiCoder } from 'ethers/lib/utils';

const TEST_SEED = 'cabin dizzy cage drastic damp surge meadow example spatial already quiz walnut';
const wallet = Wallet.fromMnemonic(TEST_SEED);

console.log('=== WALLET INFO ===');
console.log('Address:', wallet.address);
console.log('Private Key:', wallet.privateKey);

// EIP-712 Domain
const domain = {
  name: 'RealUnitUser',
  version: '1',
};

// EIP-712 Types
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

const today = '2025-12-17';

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
  console.log('\n=== MESSAGE ===');
  console.log(JSON.stringify(message, null, 2));

  // Calculate domain separator
  console.log('\n=== DOMAIN SEPARATOR ===');
  const domainSeparator = _TypedDataEncoder.hashDomain(domain);
  console.log('Domain Separator:', domainSeparator);

  // Calculate type hash
  console.log('\n=== TYPE HASH ===');
  const typeHash = _TypedDataEncoder.from(types).encodeType('RealUnitUserRegistration');
  console.log('Encoded Type:', typeHash);
  const typeHashKeccak = keccak256(toUtf8Bytes(typeHash));
  console.log('Type Hash (keccak256):', typeHashKeccak);

  // Calculate struct hash
  console.log('\n=== STRUCT HASH ===');
  const structHash = _TypedDataEncoder.from(types).hash(message);
  console.log('Struct Hash:', structHash);

  // Calculate the full hash to sign
  console.log('\n=== HASH TO SIGN ===');
  const hashToSign = _TypedDataEncoder.hash(domain, types, message);
  console.log('Hash to Sign:', hashToSign);

  // Sign
  console.log('\n=== SIGNATURE ===');
  const signature = await wallet._signTypedData(domain, types, message);
  console.log('Signature:', signature);

  // Parse signature components
  const sig = {
    r: signature.slice(0, 66),
    s: '0x' + signature.slice(66, 130),
    v: parseInt(signature.slice(130, 132), 16),
  };
  console.log('r:', sig.r);
  console.log('s:', sig.s);
  console.log('v:', sig.v);

  // Verify
  console.log('\n=== VERIFICATION ===');
  const recovered = verifyTypedData(domain, types, message, signature);
  console.log('Recovered Address:', recovered);
  console.log('Match:', recovered.toLowerCase() === wallet.address.toLowerCase());

  // Test with different field orders in the message
  console.log('\n=== FIELD ORDER TEST ===');
  const messageReordered = {
    walletAddress: wallet.address,
    email: 'test-direct@dfx.swiss',
    registrationDate: today,
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
  };
  const hashReordered = _TypedDataEncoder.hash(domain, types, messageReordered);
  console.log('Hash with reordered fields:', hashReordered);
  console.log('Same hash:', hashReordered === hashToSign);

  // Test with lowercase address
  console.log('\n=== ADDRESS CASE TEST ===');
  const messageLowercase = {
    ...message,
    walletAddress: wallet.address.toLowerCase(),
  };
  const hashLowercase = _TypedDataEncoder.hash(domain, types, messageLowercase);
  console.log('Hash with lowercase address:', hashLowercase);
  console.log('Same hash:', hashLowercase === hashToSign);

  // Test with extra field in message
  console.log('\n=== EXTRA FIELD TEST ===');
  const messageWithExtra = {
    ...message,
    kycData: { foo: 'bar' },
  };
  const hashWithExtra = _TypedDataEncoder.hash(domain, types, messageWithExtra);
  console.log('Hash with extra field:', hashWithExtra);
  console.log('Same hash:', hashWithExtra === hashToSign);

  // Check if signature is in different formats
  console.log('\n=== SIGNATURE FORMATS ===');
  console.log('Hex (65 bytes):', signature);
  console.log('Length:', (signature.length - 2) / 2, 'bytes');

  // Try different domain variations
  console.log('\n=== DOMAIN VARIATIONS ===');

  // With chainId
  const domainWithChain = { ...domain, chainId: 1 };
  const hashWithChain = _TypedDataEncoder.hash(domainWithChain, types, message);
  console.log('Hash with chainId=1:', hashWithChain);
  console.log('Same:', hashWithChain === hashToSign);

  // With verifyingContract
  const domainWithContract = { ...domain, verifyingContract: '0x0000000000000000000000000000000000000000' };
  const hashWithContract = _TypedDataEncoder.hash(domainWithContract, types, message);
  console.log('Hash with verifyingContract:', hashWithContract);
  console.log('Same:', hashWithContract === hashToSign);

  // Output for Aktionariat comparison
  console.log('\n=== FOR AKTIONARIAT COMPARISON ===');
  console.log('Please verify these values match on your end:');
  console.log('1. Domain Separator:', domainSeparator);
  console.log('2. Type Hash:', typeHashKeccak);
  console.log('3. Struct Hash:', structHash);
  console.log('4. Final Hash:', hashToSign);
  console.log('5. Signature:', signature);
}

main().catch(console.error);
