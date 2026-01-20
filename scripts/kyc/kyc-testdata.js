const mssql = require('mssql');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Safety check - only local
const dbHost = process.env.SQL_HOST || 'localhost';
if (!['localhost', '127.0.0.1'].includes(dbHost)) {
  console.error('This script only runs on localhost!');
  process.exit(1);
}

const config = {
  user: process.env.SQL_USERNAME || 'sa',
  password: process.env.SQL_PASSWORD || 'LocalDev2026@SQL',
  server: 'localhost',
  port: parseInt(process.env.SQL_PORT) || 1433,
  database: process.env.SQL_DB || 'dfx',
  options: { encrypt: false, trustServerCertificate: true }
};

function uuid() {
  return crypto.randomUUID().toUpperCase();
}

// Create dummy files directory
const dummyDir = path.join(__dirname, 'dummy-files');
if (!fs.existsSync(dummyDir)) {
  fs.mkdirSync(dummyDir, { recursive: true });
}

// Create a minimal valid PNG (1x1 pixel, red)
function createDummyPng(filename) {
  const pngData = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 pixel
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x18, 0xDD,
    0x8D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
  ]);
  const filepath = path.join(dummyDir, filename);
  fs.writeFileSync(filepath, pngData);
  return filepath;
}

// Create a minimal PDF
function createDummyPdf(filename, title) {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 120 >>
stream
BT
/F1 24 Tf
100 700 Td
(${title}) Tj
/F1 12 Tf
0 -30 Td
(Test Document for KYC Verification) Tj
0 -20 Td
(Generated: ${new Date().toISOString()}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000436 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
513
%%EOF`;
  const filepath = path.join(dummyDir, filename);
  fs.writeFileSync(filepath, pdfContent);
  return filepath;
}

// Create a JPEG-like file (minimal valid structure)
function createDummyJpg(filename) {
  // Minimal JPEG: SOI + APP0 + minimal data + EOI
  const jpgData = Buffer.from([
    0xFF, 0xD8, // SOI
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0
    0xFF, 0xDB, 0x00, 0x43, 0x00, // DQT
    0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14,
    0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A,
    0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C,
    0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32,
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, // SOF0
    0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, // DHT
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xFF, // SOS + minimal scan data
    0xFF, 0xD9 // EOI
  ]);
  const filepath = path.join(dummyDir, filename);
  fs.writeFileSync(filepath, jpgData);
  return filepath;
}

async function main() {
  console.log('Creating dummy files...');

  // Create dummy files
  const files = {
    idFront: createDummyPng('id_front.png'),
    idBack: createDummyPng('id_back.png'),
    selfie: createDummyJpg('selfie.jpg'),
    passport: createDummyPng('passport.png'),
    proofOfAddress: createDummyPdf('proof_of_address.pdf', 'Proof of Address'),
    commercialRegister: createDummyPdf('commercial_register.pdf', 'Commercial Register Extract'),
    bankStatement: createDummyPdf('bank_statement.pdf', 'Bank Statement'),
    residencePermit: createDummyPng('residence_permit.png'),
    sourceOfFunds: createDummyPdf('source_of_funds.pdf', 'Source of Funds Declaration'),
    additionalDoc: createDummyPdf('additional_document.pdf', 'Additional Document'),
  };

  console.log('  Created dummy files in:', dummyDir);
  Object.entries(files).forEach(([name, filepath]) => {
    console.log(`    - ${name}: ${path.basename(filepath)}`);
  });

  console.log('\nConnecting to database...');
  const pool = await mssql.connect(config);

  // Get user_data entries
  const userDataResult = await pool.request().query(`
    SELECT id, mail, kycLevel, firstname, surname
    FROM user_data
    WHERE mail LIKE '%@test.local' OR mail = 'bernd@dfx.swiss'
    ORDER BY id
  `);

  if (userDataResult.recordset.length === 0) {
    console.log('No test user_data found. Please run scripts/testdata.js first.');
    await pool.close();
    return;
  }

  console.log(`\nFound ${userDataResult.recordset.length} user_data entries for KYC test data.\n`);

  // KYC Step configurations for different KYC levels
  const kycStepConfigs = {
    // KYC Level 10: Contact + Personal data
    10: [
      { name: 'ContactData', status: 'Completed', result: JSON.stringify({ email: 'test@example.com', phone: '+41791234567' }) },
      { name: 'PersonalData', status: 'Completed', result: JSON.stringify({ address: 'Teststrasse 1', city: 'Zurich', zip: '8000' }) },
    ],
    // KYC Level 20: + Nationality
    20: [
      { name: 'ContactData', status: 'Completed', result: JSON.stringify({ email: 'test@example.com', phone: '+41791234567' }) },
      { name: 'PersonalData', status: 'Completed', result: JSON.stringify({ address: 'Teststrasse 1', city: 'Zurich', zip: '8000' }) },
      { name: 'NationalityData', status: 'Completed', result: JSON.stringify({ nationality: 'CH' }) },
    ],
    // KYC Level 30: + Ident
    30: [
      { name: 'ContactData', status: 'Completed', result: JSON.stringify({ email: 'test@example.com', phone: '+41791234567' }) },
      { name: 'PersonalData', status: 'Completed', result: JSON.stringify({ address: 'Teststrasse 1', city: 'Zurich', zip: '8000' }) },
      { name: 'NationalityData', status: 'Completed', result: JSON.stringify({ nationality: 'CH' }) },
      { name: 'Ident', type: 'Manual', status: 'Completed', result: JSON.stringify({ firstName: 'Max', lastName: 'Mueller', birthday: '1978-11-30', nationality: { symbol: 'CH' }, documentType: 'Passport', documentNumber: 'X1234567' }) },
    ],
    // KYC Level 50: Full KYC + Financial
    50: [
      { name: 'ContactData', status: 'Completed', result: JSON.stringify({ email: 'test@example.com', phone: '+41791234567' }) },
      { name: 'PersonalData', status: 'Completed', result: JSON.stringify({ address: 'Teststrasse 1', city: 'Zurich', zip: '8000' }) },
      { name: 'NationalityData', status: 'Completed', result: JSON.stringify({ nationality: 'CH' }) },
      { name: 'Ident', type: 'Manual', status: 'Completed', result: JSON.stringify({ firstName: 'Lisa', lastName: 'Weber', birthday: '1982-05-10', nationality: { symbol: 'CH' }, documentType: 'IdCard', documentNumber: 'C9876543' }) },
      { name: 'FinancialData', status: 'Completed', result: JSON.stringify({ annualIncome: '100000-200000', sourceOfFunds: 'Salary', occupation: 'Engineer' }) },
      { name: 'DfxApproval', status: 'Completed', result: JSON.stringify({ approved: true, approvedBy: 'system' }) },
    ],
  };

  // File configurations for different KYC steps
  const fileConfigs = {
    'Ident': [
      { name: 'id_front.png', type: 'Identification', subType: 'IdentificationForm', protected: true },
      { name: 'id_back.png', type: 'Identification', subType: null, protected: true },
      { name: 'selfie.jpg', type: 'Identification', subType: null, protected: true },
    ],
    'FinancialData': [
      { name: 'source_of_funds.pdf', type: 'UserInformation', subType: 'RiskProfile', protected: false },
      { name: 'bank_statement.pdf', type: 'UserInformation', subType: 'BankTransactionVerification', protected: false },
    ],
    'DfxApproval': [
      { name: 'additional_document.pdf', type: 'AdditionalDocuments', subType: null, protected: false },
    ],
  };

  console.log('Creating KYC Steps and Files...\n');

  for (const userData of userDataResult.recordset) {
    const kycLevel = userData.kycLevel || 0;
    const steps = kycStepConfigs[kycLevel];

    if (!steps) {
      console.log(`  UserData ${userData.id} (${userData.mail}): KYC Level ${kycLevel} - no steps defined`);
      continue;
    }

    console.log(`  UserData ${userData.id} (${userData.mail}): KYC Level ${kycLevel}`);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Check if step already exists
      const existingStep = await pool.request()
        .input('userDataId', mssql.Int, userData.id)
        .input('name', mssql.NVarChar, step.name)
        .input('seqNum', mssql.Int, i + 1)
        .query('SELECT id FROM kyc_step WHERE userDataId = @userDataId AND name = @name AND sequenceNumber = @seqNum');

      let stepId;
      if (existingStep.recordset.length > 0) {
        stepId = existingStep.recordset[0].id;
        console.log(`    - Step ${step.name} already exists (id=${stepId})`);
      } else {
        const stepResult = await pool.request()
          .input('userDataId', mssql.Int, userData.id)
          .input('name', mssql.NVarChar, step.name)
          .input('type', mssql.NVarChar, step.type || null)
          .input('status', mssql.NVarChar, step.status)
          .input('sequenceNumber', mssql.Int, i + 1)
          .input('result', mssql.NVarChar, step.result || null)
          .input('sessionId', mssql.NVarChar, uuid())
          .query(`
            INSERT INTO kyc_step (userDataId, name, type, status, sequenceNumber, result, sessionId, created, updated)
            OUTPUT INSERTED.id
            VALUES (@userDataId, @name, @type, @status, @sequenceNumber, @result, @sessionId, GETUTCDATE(), GETUTCDATE())
          `);
        stepId = stepResult.recordset[0].id;
        console.log(`    - Created Step ${step.name} (id=${stepId})`);
      }

      // Create files for this step if configured
      const fileConfigsForStep = fileConfigs[step.name];
      if (fileConfigsForStep) {
        for (const fileConfig of fileConfigsForStep) {
          const fileUid = uuid();

          const existingFile = await pool.request()
            .input('userDataId', mssql.Int, userData.id)
            .input('name', mssql.NVarChar, fileConfig.name)
            .input('kycStepId', mssql.Int, stepId)
            .query('SELECT id FROM kyc_file WHERE userDataId = @userDataId AND name = @name AND kycStepId = @kycStepId');

          if (existingFile.recordset.length > 0) {
            console.log(`      - File ${fileConfig.name} already exists`);
          } else {
            await pool.request()
              .input('name', mssql.NVarChar, fileConfig.name)
              .input('type', mssql.NVarChar, fileConfig.type)
              .input('subType', mssql.NVarChar, fileConfig.subType)
              .input('protected', mssql.Bit, fileConfig.protected)
              .input('valid', mssql.Bit, true)
              .input('uid', mssql.NVarChar, fileUid)
              .input('userDataId', mssql.Int, userData.id)
              .input('kycStepId', mssql.Int, stepId)
              .query(`
                INSERT INTO kyc_file (name, type, subType, protected, valid, uid, userDataId, kycStepId, created, updated)
                VALUES (@name, @type, @subType, @protected, @valid, @uid, @userDataId, @kycStepId, GETUTCDATE(), GETUTCDATE())
              `);
            console.log(`      - Created File ${fileConfig.name} (uid=${fileUid.substring(0, 8)}...)`);
          }
        }
      }
    }
  }

  // Create KYC Log entries
  console.log('\nCreating KYC Log entries...');

  const kycSteps = await pool.request().query('SELECT id, userDataId, name, status FROM kyc_step');

  for (const step of kycSteps.recordset.slice(0, 5)) {
    const existingLog = await pool.request()
      .input('kycStepId', mssql.Int, step.id)
      .query('SELECT id FROM kyc_log WHERE kycStepId = @kycStepId');

    if (existingLog.recordset.length === 0) {
      await pool.request()
        .input('kycStepId', mssql.Int, step.id)
        .input('status', mssql.NVarChar, step.status)
        .input('result', mssql.NVarChar, 'System: KYC step processed')
        .query(`
          INSERT INTO kyc_log (kycStepId, status, result, created, updated)
          VALUES (@kycStepId, @status, @result, GETUTCDATE(), GETUTCDATE())
        `);
      console.log(`  - Created log for step ${step.id} (${step.name})`);
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('KYC Test Data Creation Complete!');
  console.log('========================================\n');

  const stepCount = await pool.request().query('SELECT COUNT(*) as c FROM kyc_step');
  const fileCount = await pool.request().query('SELECT COUNT(*) as c FROM kyc_file');
  const logCount = await pool.request().query('SELECT COUNT(*) as c FROM kyc_log');

  console.log(`  kyc_step: ${stepCount.recordset[0].c} rows`);
  console.log(`  kyc_file: ${fileCount.recordset[0].c} rows`);
  console.log(`  kyc_log:  ${logCount.recordset[0].c} rows`);
  console.log(`\n  Dummy files location: ${dummyDir}`);

  await pool.close();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
