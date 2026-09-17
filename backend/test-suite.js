const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.env.PORT = '4001'; // use test port to avoid conflict
process.env.DATABASE_PATH = './data/test-aum.db';

const { app, server } = require('./src/server');

const BASE_URL = 'http://localhost:4001';

async function runTests() {
  console.log('\n--- STARTING AUM ANALYTIC BACKEND TEST SUITE ---\n');
  let token = '';
  let submissionId = null;

  try {
    // 1. Health check
    console.log('1. Testing GET /api/health...');
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    assert.strictEqual(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.strictEqual(healthJson.status, 'ok');
    console.log('   ✓ Health check passed');

    // 2. Admin login with bad credentials
    console.log('2. Testing POST /api/admin/login with incorrect credentials...');
    const badLoginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'WrongPassword' }),
    });
    assert.strictEqual(badLoginRes.status, 401);
    console.log('   ✓ Bad login rejected with 401');

    // 3. Admin login with correct credentials
    console.log('3. Testing POST /api/admin/login with valid credentials...');
    const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin@12345' }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginJson = await loginRes.json();
    assert(loginJson.token, 'Token should be returned');
    token = loginJson.token;
    console.log('   ✓ Valid login successful, token obtained');

    // 4. Unauthorized access to admin submissions list
    console.log('4. Testing GET /api/requirements without token...');
    const unauthRes = await fetch(`${BASE_URL}/api/requirements`);
    assert.strictEqual(unauthRes.status, 401);
    console.log('   ✓ Unauthenticated access rejected with 401');

    // 5. Validation failure on public requirement submission
    console.log('5. Testing POST /api/requirements validation errors...');
    const invalidForm = new FormData();
    invalidForm.append('fullName', 'Test');
    invalidForm.append('companyName', ''); // missing
    invalidForm.append('email', 'not-an-email'); // invalid
    invalidForm.append('phone', '');

    const invalidRes = await fetch(`${BASE_URL}/api/requirements`, {
      method: 'POST',
      body: invalidForm,
    });
    assert.strictEqual(invalidRes.status, 400);
    const invalidJson = await invalidRes.json();
    assert(invalidJson.message.includes('Company name is required'));
    assert(invalidJson.message.includes('valid business email'));
    console.log('   ✓ Form validation rejected bad input with 400 and clear message');

    // 6. Valid public requirement submission with file attachment
    console.log('6. Testing POST /api/requirements with valid data and file upload...');
    const validForm = new FormData();
    validForm.append('fullName', 'John Doe');
    validForm.append('companyName', 'Acme Corp');
    validForm.append('email', 'john@acmecorp.com');
    validForm.append('phone', '+1 555-0199');
    validForm.append('industry', 'FinTech');
    validForm.append('serviceRequired', 'Permanent Recruitment');
    validForm.append('numberOfPositions', '3');
    validForm.append('jobDetails', 'Senior Full Stack Engineer needed.');

    const sampleBlob = new Blob(['Job description content: Senior Node.js and React Developer.'], { type: 'text/plain' });
    validForm.append('jobDescription', sampleBlob, 'job-spec.txt');

    const submitRes = await fetch(`${BASE_URL}/api/requirements`, {
      method: 'POST',
      body: validForm,
    });
    assert.strictEqual(submitRes.status, 201);
    const submitJson = await submitRes.json();
    assert(submitJson.id, 'Submission ID should be returned');
    submissionId = submitJson.id;
    console.log(`   ✓ Submission created with ID: ${submissionId}`);

    // 7. Admin lists submissions
    console.log('7. Testing GET /api/requirements with Bearer token...');
    const listRes = await fetch(`${BASE_URL}/api/requirements`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    assert.strictEqual(listRes.status, 200);
    const listJson = await listRes.json();
    assert(listJson.requirements.length > 0);
    const found = listJson.requirements.find(r => r.id === submissionId);
    assert(found, 'Created submission must be present in requirements list');
    assert.strictEqual(found.full_name, 'John Doe');
    assert.strictEqual(found.company_name, 'Acme Corp');
    assert.strictEqual(found.number_of_positions, 3);
    assert(found.file_path, 'File path must be set');
    console.log('   ✓ Admin listing verified successfully');

    // 8. Admin downloads file
    console.log(`8. Testing GET /api/requirements/${submissionId}/file...`);
    const fileRes = await fetch(`${BASE_URL}/api/requirements/${submissionId}/file`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    assert.strictEqual(fileRes.status, 200);
    const fileText = await fileRes.text();
    assert(fileText.includes('Senior Node.js and React Developer'));
    console.log('   ✓ File download succeeded with correct content');

    // 9. Admin rate limiter test: 25 consecutive requests must NOT be rate limited
    console.log('9. Testing Admin requests are NOT rate limited (25 rapid requests)...');
    for (let i = 0; i < 25; i++) {
      const r = await fetch(`${BASE_URL}/api/requirements`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      assert.strictEqual(r.status, 200, `Request #${i+1} failed with status ${r.status}`);
    }
    console.log('   ✓ Admin requests successfully bypassed public submission rate limiter');

    // 10. Admin delete submission
    console.log(`10. Testing DELETE /api/requirements/${submissionId}...`);
    const delRes = await fetch(`${BASE_URL}/api/requirements/${submissionId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    assert.strictEqual(delRes.status, 200);
    const verifyDel = await fetch(`${BASE_URL}/api/requirements/${submissionId}/file`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    assert.strictEqual(verifyDel.status, 404);
    console.log('   ✓ Submission and file deleted successfully');

    // 11. API 404 handler
    console.log('11. Testing 404 for unknown /api/* endpoint...');
    const notFoundRes = await fetch(`${BASE_URL}/api/nonexistent`);
    assert.strictEqual(notFoundRes.status, 404);
    const notFoundJson = await notFoundRes.json();
    assert.strictEqual(notFoundJson.message, 'API endpoint not found.');
    console.log('   ✓ 404 handler returns clean JSON');

    console.log('\n========================================');
    console.log('ALL 11 BACKEND TESTS PASSED SUCCESSFULLY');
    console.log('========================================\n');
  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
    // Cleanup test database
    try {
      const testDbPath = path.resolve(__dirname, 'data', 'test-aum.db');
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      const testDbWal = path.resolve(__dirname, 'data', 'test-aum.db-wal');
      if (fs.existsSync(testDbWal)) fs.unlinkSync(testDbWal);
      const testDbShm = path.resolve(__dirname, 'data', 'test-aum.db-shm');
      if (fs.existsSync(testDbShm)) fs.unlinkSync(testDbShm);
    } catch (e) {}
  }
}

runTests();
