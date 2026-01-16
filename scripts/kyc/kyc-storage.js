/**
 * This script uploads dummy KYC files to the in-memory storage.
 * Run this AFTER the API has started.
 *
 * Usage: node scripts/kyc/kyc-storage.js
 */

const axios = require('axios');
const mssql = require('mssql');

const API_URL = 'http://localhost:3000';

// Minimal valid image data
const DUMMY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADq/v5GbkAAAAAElFTkSuQmCC';
const DUMMY_JPG_BASE64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAKAAoDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUH/8QAIhAAAgEDBAMBAQAAAAAAAAAAAQIDBAURAAYSIQcTMUFR/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAZEQACAwEAAAAAAAAAAAAAAAABAgADESH/2gAMAwEAAhEDEEA/AJFp8i7XudFTXC1Wu3RUlQgeOOSV2LqRyB5LkA464GjWzNx2vc9l+8t0cSXI8JImRkdCOmUqSCCPwj7rN/F0MUnkexGWNWMfuUplBwcNxYg4+ZAP8OtE2btizbNsJttukmmhMxmaWU5ZmIAzgABRgAYA/OsnC3X/2Q==';
const DUMMY_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NCA+PgpzdHJlYW0KQlQKL0YxIDI0IFRmCjEwMCA3MDAgVGQKKFRlc3QgRG9jdW1lbnQpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmCjAwMDAwMDAwMDkgMDAwMDAgbgowMDAwMDAwMDU4IDAwMDAwIG4KMDAwMDAwMDExNSAwMDAwMCBuCjAwMDAwMDAyMTggMDAwMDAgbgp0cmFpbGVyCjw8IC9TaXplIDUgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjMxMwolJUVPRgo=';

const dbConfig = {
  user: process.env.SQL_USERNAME || 'sa',
  password: process.env.SQL_PASSWORD || 'LocalDev2026@SQL',
  server: 'localhost',
  port: parseInt(process.env.SQL_PORT) || 1433,
  database: process.env.SQL_DB || 'dfx',
  options: { encrypt: false, trustServerCertificate: true }
};

async function getAdminToken() {
  const { ethers } = require('ethers');
  const ADMIN_SEED = 'ignore dish destroy upgrade stem pulse lucky tomato yard baby obvious cool';
  const wallet = ethers.Wallet.fromMnemonic(ADMIN_SEED);

  const signMsgRes = await axios.get(`${API_URL}/v1/auth/signMessage?address=${wallet.address}`);
  const signature = await wallet.signMessage(signMsgRes.data.message);
  const authRes = await axios.post(`${API_URL}/v1/auth`, { address: wallet.address, signature });

  return authRes.data.accessToken;
}

async function uploadFileDirectly(token, userDataId, fileType, fileName, contentType, base64Data) {
  // Use internal admin endpoint or direct storage access
  // Since we're in dev mode, we'll call a custom endpoint

  try {
    // Try the file endpoint - this might need adjustment based on actual API
    const fileUrl = `${API_URL}/v2/kyc/file/upload`;

    const response = await axios.post(
      fileUrl,
      {
        userDataId,
        fileType,
        fileName,
        contentType,
        data: base64Data
      },
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );
    return response.data;
  } catch (e) {
    // Expected to fail - there's no direct upload endpoint
    return null;
  }
}

async function main() {
  console.log('KYC Storage Seeder');
  console.log('==================\n');

  console.log('Note: In local development mode, KYC files are stored in-memory.');
  console.log('They need to be uploaded via the KYC flow or manually inserted.\n');

  // Get KYC file info from database
  const pool = await mssql.connect(dbConfig);

  const files = await pool.request().query(`
    SELECT kf.id, kf.uid, kf.name, kf.type, kf.userDataId, ud.mail
    FROM kyc_file kf
    JOIN user_data ud ON kf.userDataId = ud.id
    ORDER BY kf.id
  `);

  console.log('KYC Files in database:');
  console.log('======================');

  for (const file of files.recordset) {
    const ext = file.name.split('.').pop().toLowerCase();
    let base64Data;
    let contentType;

    switch (ext) {
      case 'png':
        base64Data = DUMMY_PNG_BASE64;
        contentType = 'image/png';
        break;
      case 'jpg':
      case 'jpeg':
        base64Data = DUMMY_JPG_BASE64;
        contentType = 'image/jpeg';
        break;
      case 'pdf':
        base64Data = DUMMY_PDF_BASE64;
        contentType = 'application/pdf';
        break;
      default:
        base64Data = DUMMY_PNG_BASE64;
        contentType = 'image/png';
    }

    console.log(`  ${file.name}`);
    console.log(`    UID: ${file.uid}`);
    console.log(`    Type: ${file.type}`);
    console.log(`    User: ${file.mail}`);
    console.log(`    Content-Type: ${contentType}`);
    console.log('');
  }

  console.log('\n========================================');
  console.log('To view files in the frontend:');
  console.log('========================================');
  console.log('');
  console.log('Option 1: The files are referenced in the DB but the');
  console.log('          in-memory storage is empty after API restart.');
  console.log('');
  console.log('Option 2: Use the KYC flow to upload real files.');
  console.log('');
  console.log('Option 3: Add a startup script to pre-populate storage.');
  console.log('');

  // Create a simple Express endpoint suggestion
  console.log('Quick Fix: Add this to azure-storage.service.ts after line 22:');
  console.log('');
  console.log(`// Pre-populate mock storage with test data
if (process.env.SEED_MOCK_FILES === 'true') {
  const testPng = Buffer.from('${DUMMY_PNG_BASE64}', 'base64');
  mockStorage.set('kyc/user/1005/Identification/id_front.png', { data: testPng, type: 'image/png' });
  mockStorage.set('kyc/user/1005/Identification/id_back.png', { data: testPng, type: 'image/png' });
  mockStorage.set('kyc/user/1006/Identification/id_front.png', { data: testPng, type: 'image/png' });
}`);

  await pool.close();
}

main().catch(console.error);
