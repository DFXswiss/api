import { keccak256, toUtf8Bytes, defaultAbiCoder } from 'ethers/lib/utils';

// Test different domain type encodings
console.log('=== DOMAIN TYPE ENCODING ===\n');

// Minimal domain (name + version only)
const domainType1 = 'EIP712Domain(string name,string version)';
const domainHash1 = keccak256(toUtf8Bytes(domainType1));
console.log('Domain Type (name,version):');
console.log('  Type:', domainType1);
console.log('  Hash:', domainHash1);

// With chainId
const domainType2 = 'EIP712Domain(string name,string version,uint256 chainId)';
const domainHash2 = keccak256(toUtf8Bytes(domainType2));
console.log('\nDomain Type (name,version,chainId):');
console.log('  Type:', domainType2);
console.log('  Hash:', domainHash2);

// With verifyingContract
const domainType3 = 'EIP712Domain(string name,string version,address verifyingContract)';
const domainHash3 = keccak256(toUtf8Bytes(domainType3));
console.log('\nDomain Type (name,version,verifyingContract):');
console.log('  Type:', domainType3);
console.log('  Hash:', domainHash3);

// Full domain
const domainType4 = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
const domainHash4 = keccak256(toUtf8Bytes(domainType4));
console.log('\nDomain Type (full):');
console.log('  Type:', domainType4);
console.log('  Hash:', domainHash4);

// Calculate domain separator manually for (name, version)
console.log('\n=== MANUAL DOMAIN SEPARATOR CALCULATION ===\n');

const name = 'RealUnitUser';
const version = '1';

const nameHash = keccak256(toUtf8Bytes(name));
const versionHash = keccak256(toUtf8Bytes(version));

console.log('name:', name);
console.log('nameHash:', nameHash);
console.log('version:', version);
console.log('versionHash:', versionHash);

// Domain separator = keccak256(domainTypeHash + nameHash + versionHash)
const domainSeparatorData = defaultAbiCoder.encode(
  ['bytes32', 'bytes32', 'bytes32'],
  [domainHash1, nameHash, versionHash]
);
const domainSeparator = keccak256(domainSeparatorData);

console.log('\nDomain Separator (manual):', domainSeparator);
console.log('Expected from ethers:', '0x052e6032c09842da3a73245b0795652211519a993602eacaf004e587988b3f17');
console.log('Match:', domainSeparator === '0x052e6032c09842da3a73245b0795652211519a993602eacaf004e587988b3f17');

// Test struct type encoding
console.log('\n=== STRUCT TYPE ENCODING ===\n');

const structType = 'RealUnitUserRegistration(string email,string name,string type,string phoneNumber,string birthday,string nationality,string addressStreet,string addressPostalCode,string addressCity,string addressCountry,bool swissTaxResidence,string registrationDate,address walletAddress)';
const structTypeHash = keccak256(toUtf8Bytes(structType));

console.log('Struct Type:', structType);
console.log('Struct Type Hash:', structTypeHash);
console.log('Expected:', '0xaa54e9cd9a3243b28d68b7e7097aab7dabd6e380cb30a656b00a2a222ee4874c');
console.log('Match:', structTypeHash === '0xaa54e9cd9a3243b28d68b7e7097aab7dabd6e380cb30a656b00a2a222ee4874c');

// Check if there are any whitespace or encoding issues
console.log('\n=== STRING ENCODING CHECK ===\n');
console.log('structType length:', structType.length);
console.log('structType bytes:', Buffer.from(structType).toString('hex'));
