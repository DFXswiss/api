import { Wallet } from 'ethers';
import { verifyTypedData, recoverAddress, hashMessage, splitSignature, joinSignature } from 'ethers/lib/utils';
import { _TypedDataEncoder } from 'ethers/lib/utils';

const TEST_SEED = 'cabin dizzy cage drastic damp surge meadow example spatial already quiz walnut';
const wallet = Wallet.fromMnemonic(TEST_SEED);

const domain = { name: 'RealUnitUser', version: '1' };

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
  registrationDate: '2025-12-17',
  walletAddress: wallet.address,
};

async function main() {
  const signature = await wallet._signTypedData(domain, types, message);
  const digest = _TypedDataEncoder.hash(domain, types, message);

  console.log('=== SIGNATURE ANALYSIS ===\n');
  console.log('Original Signature:', signature);
  console.log('Digest:', digest);
  console.log('Expected Address:', wallet.address);

  // Split signature
  const split = splitSignature(signature);
  console.log('\n=== SPLIT SIGNATURE ===');
  console.log('r:', split.r);
  console.log('s:', split.s);
  console.log('v:', split.v);
  console.log('recoveryParam:', split.recoveryParam);
  console.log('compact:', split.compact);

  // Test recovery with different v values
  console.log('\n=== RECOVERY TESTS ===');

  // Original v
  const recovered1 = recoverAddress(digest, signature);
  console.log('Recovered with v=' + split.v + ':', recovered1);

  // Try with v flipped (27<->28)
  const flippedV = split.v === 27 ? 28 : 27;
  const flippedSig = joinSignature({ ...split, v: flippedV, recoveryParam: flippedV - 27 });
  try {
    const recovered2 = recoverAddress(digest, flippedSig);
    console.log('Recovered with v=' + flippedV + ':', recovered2);
  } catch (e) {
    console.log('Recovery with v=' + flippedV + ' failed:', e.message);
  }

  // Test with compact signature
  console.log('\n=== COMPACT SIGNATURE ===');
  console.log('Compact:', split.compact);
  console.log('Length:', (split.compact.length - 2) / 2, 'bytes');

  // Verify using verifyTypedData
  console.log('\n=== VERIFICATION ===');
  const verified = verifyTypedData(domain, types, message, signature);
  console.log('verifyTypedData result:', verified);
  console.log('Match:', verified.toLowerCase() === wallet.address.toLowerCase());

  // Check different signature formats
  console.log('\n=== SIGNATURE FORMATS ===');
  console.log('Standard (r+s+v):', signature);
  console.log('Without 0x:', signature.slice(2));

  // RSV components separately
  console.log('\nr (32 bytes):', split.r);
  console.log('s (32 bytes):', split.s);
  console.log('v (1 byte):', '0x' + split.v.toString(16).padStart(2, '0'));

  // Some systems expect v as 0 or 1 instead of 27 or 28
  console.log('\n=== ALTERNATIVE V VALUES ===');
  console.log('v=27 (standard):', split.v);
  console.log('v=0 (alternative):', split.v - 27);

  // Construct signature with v=0/1
  const altV = split.v - 27;
  const altSigHex = split.r + split.s.slice(2) + altV.toString(16).padStart(2, '0');
  console.log('Signature with v=0/1:', altSigHex);

  // Final summary for Aktionariat
  console.log('\n=== SUMMARY FOR AKTIONARIAT ===');
  console.log('Private Key:', wallet.privateKey);
  console.log('Address:', wallet.address);
  console.log('Message Hash (digest):', digest);
  console.log('Signature:', signature);
  console.log('r:', split.r);
  console.log('s:', split.s);
  console.log('v:', split.v, '(or', split.v - 27, 'in 0/1 format)');
}

main().catch(console.error);
