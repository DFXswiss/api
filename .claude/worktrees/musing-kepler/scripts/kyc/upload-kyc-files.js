const axios = require('axios');

const API_URL = 'http://localhost:3000';

// Dummy file data (base64 encoded minimal files)
const DUMMY_FILES = {
  // Minimal 1x1 red PNG
  'png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  // Minimal PDF
  'pdf': 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSA+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmCjAwMDAwMDAwMDkgMDAwMDAgbgowMDAwMDAwMDU4IDAwMDAwIG4KMDAwMDAwMDExNSAwMDAwMCBuCnRyYWlsZXIKPDwgL1NpemUgNCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMTk1CiUlRU9G',
  // Minimal JPEG (1x1 red pixel)
  'jpg': '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwAB//9k='
};

async function getAdminToken() {
  const { ethers } = require('ethers');
  const ADMIN_SEED = 'ignore dish destroy upgrade stem pulse lucky tomato yard baby obvious cool';
  const wallet = ethers.Wallet.fromMnemonic(ADMIN_SEED);

  // Get sign message
  const signMsgRes = await axios.get(`${API_URL}/v1/auth/signMessage?address=${wallet.address}`);
  const message = signMsgRes.data.message;

  // Sign message
  const signature = await wallet.signMessage(message);

  // Authenticate
  const authRes = await axios.post(`${API_URL}/v1/auth`, {
    address: wallet.address,
    signature: signature
  });

  return authRes.data.accessToken;
}

async function getKycCodes() {
  const mssql = require('mssql');
  const config = {
    user: process.env.SQL_USERNAME || 'sa',
    password: process.env.SQL_PASSWORD || 'LocalDev2026@SQL',
    server: 'localhost',
    port: parseInt(process.env.SQL_PORT) || 1433,
    database: process.env.SQL_DB || 'dfx',
    options: { encrypt: false, trustServerCertificate: true }
  };

  const pool = await mssql.connect(config);

  const result = await pool.request().query(`
    SELECT ud.id, ud.kycHash, ud.mail, ud.kycLevel,
           ks.id as stepId, ks.name as stepName
    FROM user_data ud
    LEFT JOIN kyc_step ks ON ks.userDataId = ud.id AND ks.name = 'Ident'
    WHERE ud.kycLevel >= 30
    ORDER BY ud.id
  `);

  await pool.close();
  return result.recordset;
}

async function uploadFileViaAPI(token, kycCode, stepId, fileData, fileName, fileType) {
  try {
    // The manual ident endpoint accepts file data
    const response = await axios.put(
      `${API_URL}/v2/kyc/ident/manual/${stepId}`,
      {
        firstName: 'Test',
        lastName: 'User',
        birthday: '1990-01-01',
        nationality: { id: 1 },
        documentType: 'Passport',
        documentNumber: 'X1234567',
        documentFront: `data:image/${fileType};base64,${fileData}`,
        documentBack: `data:image/${fileType};base64,${fileData}`,
        selfie: `data:image/jpg;base64,${DUMMY_FILES.jpg}`
      },
      {
        headers: {
          'x-kyc-code': kycCode,
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  } catch (e) {
    console.log(`    Error: ${e.response?.data?.message || e.message}`);
    return null;
  }
}

async function main() {
  console.log('KYC File Upload Script');
  console.log('======================\n');

  try {
    // Get admin token
    console.log('Getting admin token...');
    const token = await getAdminToken();
    console.log('  Token obtained.\n');

    // Get KYC codes for users with level >= 30
    console.log('Getting KYC codes...');
    const kycData = await getKycCodes();
    console.log(`  Found ${kycData.length} entries.\n`);

    for (const entry of kycData) {
      if (!entry.stepId) {
        console.log(`Skipping ${entry.mail} - no Ident step`);
        continue;
      }

      console.log(`Processing ${entry.mail} (KYC Level ${entry.kycLevel}):`);
      console.log(`  KYC Code: ${entry.kycHash}`);
      console.log(`  Step ID: ${entry.stepId}`);

      // Try to upload via manual ident
      const result = await uploadFileViaAPI(
        token,
        entry.kycHash,
        entry.stepId,
        DUMMY_FILES.png,
        'id_document.png',
        'png'
      );

      if (result) {
        console.log(`  Upload successful!`);
      }
    }

    console.log('\n========================================');
    console.log('Note: Files are stored in memory and will');
    console.log('be lost when the API restarts.');
    console.log('========================================\n');

  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
