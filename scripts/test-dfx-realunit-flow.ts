import { Wallet } from 'ethers';

// Fresh wallet for each test
const wallet = Wallet.createRandom();
console.log('Generated Seed:', wallet.mnemonic.phrase);

const DFX_API = 'https://api.dfx.swiss';

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

async function main() {
  console.log('=== DFX RealUnit Registration Test ===\n');
  console.log('Wallet Address:', wallet.address);

  // Step 1: Sign up
  console.log('\n--- Step 1: Sign Up ---');
  const signUpMessage = `By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_${wallet.address}`;
  const signUpSig = await wallet.signMessage(signUpMessage);

  const signUpRes = await fetch(`${DFX_API}/v1/auth/signUp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: wallet.address,
      signature: signUpSig,
    }),
  });
  const signUpData = await signUpRes.json();
  console.log('Status:', signUpRes.status);

  if (signUpRes.status !== 201) {
    console.log('Sign up response:', JSON.stringify(signUpData, null, 2));
  }

  // Step 2: Sign in
  console.log('\n--- Step 2: Sign In ---');
  const signInMessage = `By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_${wallet.address}`;
  const signInSig = await wallet.signMessage(signInMessage);

  const signInRes = await fetch(`${DFX_API}/v1/auth/signIn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: wallet.address,
      signature: signInSig,
    }),
  });
  const signInData = await signInRes.json();
  console.log('Status:', signInRes.status);

  if (signInRes.status !== 201) {
    console.log('Sign in failed:', JSON.stringify(signInData, null, 2));
    return;
  }

  const accessToken = signInData.accessToken;
  console.log('Access Token:', accessToken.substring(0, 50) + '...');

  // Step 3: Get user data to get kycHash
  console.log('\n--- Step 3: Get KYC Hash ---');
  const userRes = await fetch(`${DFX_API}/v1/user`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const userData = await userRes.json();
  const kycHash = userData.kycHash;
  console.log('KYC Hash:', kycHash);

  // Step 4: Start KYC to get step ID
  console.log('\n--- Step 4: Continue KYC ---');
  const kycRes = await fetch(`${DFX_API}/v2/kyc`, {
    method: 'PUT',
    headers: { 'x-kyc-code': kycHash },
  });
  const kycSessionData = await kycRes.json();
  console.log('KYC status:', kycRes.status);
  console.log('KYC data:', JSON.stringify(kycSessionData, null, 2));

  // Get the contact step ID from session URL
  const sessionUrl = kycSessionData.currentStep?.session?.url;
  const stepId = sessionUrl ? sessionUrl.split('/').pop() : undefined;
  console.log('Session URL:', sessionUrl);
  console.log('Contact Step ID:', stepId);

  // Step 5: Set email via KYC v2
  const testEmail = `test-prod-${Date.now()}@dfx.swiss`;
  console.log('\n--- Step 5: Set Email via KYC v2 ---');
  console.log('Email:', testEmail);

  if (stepId) {
    const mailRes = await fetch(`${DFX_API}/v2/kyc/data/contact/${stepId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-kyc-code': kycHash,
      },
      body: JSON.stringify({ mail: testEmail }),
    });
    console.log('Set mail status:', mailRes.status);
    const mailData = await mailRes.json().catch(() => ({}));
    console.log('Mail response:', JSON.stringify(mailData, null, 2));
  } else {
    console.log('No step ID found, skipping email set');
  }

  // Step 6: RealUnit Registration
  console.log('\n--- Step 6: RealUnit Registration ---');
  const today = new Date().toISOString().split('T')[0];

  const message = {
    email: testEmail,
    name: 'Test Production',
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

  const signature = await wallet._signTypedData(domain, types, message);
  console.log('Signature:', signature);

  // kycData must match the signed data
  const kycData = {
    accountType: 'Personal',
    firstName: 'Test',
    lastName: 'Production',
    phone: '+41791234567',
    address: {
      street: 'Teststrasse 1',
      city: 'Zurich',
      zip: '8000',
      country: { id: 41 },  // Switzerland
    },
  };

  const realunitRes = await fetch(`${DFX_API}/v1/realunit/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      ...message,
      signature,
      lang: 'DE',
      kycData,
    }),
  });

  const realunitData = await realunitRes.json().catch(() => realunitRes.text());
  console.log('Status:', realunitRes.status);
  console.log('Response:', JSON.stringify(realunitData, null, 2));
}

main().catch(console.error);
