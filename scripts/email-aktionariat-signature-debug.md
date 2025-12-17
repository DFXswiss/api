Subject: RealUnit Registration - Invalid Signature Debugging

Hi Murat,

We've implemented the RealUnit registration endpoint on our side and are receiving "Invalid signature" errors from your API.

We've thoroughly verified our EIP-712 implementation locally - signature recovery works correctly and returns the expected wallet address. However, your endpoint still rejects the signature.

As you offered in your previous email, could you please sign the following test data using the shared seed phrase and share your intermediate hashes? This will help us identify exactly where the discrepancy is.

## Test Seed Phrase
```
cabin dizzy cage drastic damp surge meadow example spatial already quiz walnut
```

## Expected Wallet Address
```
0xD29C323DfD441E5157F5a05ccE6c74aC94c57aAd
```

## Test Message
```json
{
  "email": "test-direct@dfx.swiss",
  "name": "Test Direct",
  "type": "HUMAN",
  "phoneNumber": "+41791234567",
  "birthday": "1990-01-15",
  "nationality": "CH",
  "addressStreet": "Teststrasse 1",
  "addressPostalCode": "8000",
  "addressCity": "Zurich",
  "addressCountry": "CH",
  "swissTaxResidence": true,
  "registrationDate": "2025-12-17",
  "walletAddress": "0xD29C323DfD441E5157F5a05ccE6c74aC94c57aAd"
}
```

## Our Intermediate Hashes
```
Domain Separator: 0x052e6032c09842da3a73245b0795652211519a993602eacaf004e587988b3f17
Type Hash:        0xaa54e9cd9a3243b28d68b7e7097aab7dabd6e380cb30a656b00a2a222ee4874c
Struct Hash:      0x59b623f5d827ff11648957f3cab27226bb3075b1dfb66b00a1a6f5937b4f5806
Final Digest:     0xa4ff9ebcf2c2fa145c1c8a6065c64e2044b4553920e8046685dadbf6e99325b0
```

## Our Signature
```
0x9196c073b4f0c8a6e386b21a53fee91cb16299624226c7155266af46aacfac7a7451f29178de1c5f71992872dca5a6a917c3557d78a456fefe15d58d9cd012571b
```

Could you please:
1. Sign the same message using the test seed phrase above
2. Share your intermediate hashes (Domain Separator, Type Hash, Struct Hash, Final Digest)
3. Share your resulting signature

This will help us pinpoint exactly where our implementations differ.

Best regards,
Cyrill
