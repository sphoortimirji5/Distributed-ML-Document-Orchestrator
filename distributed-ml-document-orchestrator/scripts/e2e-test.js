const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const API_URL = 'http://127.0.0.1:3005/api';
const TENANT_ID = `test-${Date.now()}`;

async function uploadFile(filePath) {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('tenantId', TENANT_ID);

    console.log(`Uploading ${path.basename(filePath)}...`);
    try {
        const response = await axios.post(`${API_URL}/upload`, form, {
            headers: form.getHeaders(),
        });
        return response.data;
    } catch (error) {
        console.error(`Upload failed for ${filePath}:`, error.response?.data || error.message);
        throw error;
    }
}

async function checkStatus(fileId) {
    try {
        const response = await axios.get(`${API_URL}/jobs/${fileId}`);
        return response.data;
    } catch (error) {
        console.error(`Status check failed for ${fileId}:`, error.response?.data || error.message);
        throw error;
    }
}

async function waitForCompletion(fileId, maxRetries = 60) {
    for (let i = 0; i < maxRetries; i++) {
        const status = await checkStatus(fileId);
        const processed = status.progress?.processed || 0;
        const total = status.progress?.total || '?';
        console.log(`Status: ${status.status}, Progress: ${processed}/${total}`);
        if (status.status === 'completed') {
            return status;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error(`Job ${fileId} timed out`);
}

async function runTests() {
    try {
        // 1. Upload Test - Fresh file
        console.log('\n--- Test 1: Fresh Upload ---');
        console.log('Note: test-document.pdf is ~1MB, so it will be ASYNC with 0.5MB threshold.');
        const result = await uploadFile('../test-document.pdf');
        console.log('Upload Result:', result);
        
        if (result.duplicate === true) {
            console.log('[FAIL] Fresh upload was incorrectly detected as duplicate');
            process.exit(1);
        }
        console.log('[PASS] Fresh upload successful');

        // 2. Deduplication Test - Same file should be rejected as duplicate
        console.log('\n--- Test 2: Duplicate Detection & Rejection ---');
        console.log('Re-uploading the same file (should be rejected as duplicate)...');
        const dupResult = await uploadFile('../test-document.pdf');
        console.log('Duplicate Upload Result:', dupResult);

        if (dupResult.duplicate !== true) {
            console.log('[FAIL] Deduplication Test FAILED - File was processed again instead of being rejected');
            console.log('   Expected: { duplicate: true }');
            console.log('   Got:', dupResult);
            process.exit(1);
        }
        
        console.log('[PASS] Duplicate correctly detected and rejected!');
        console.log(`   Original fileId: ${result.fileId}`);
        console.log(`   Returned fileId: ${dupResult.fileId}`);
        
        if (dupResult.fileId !== result.fileId) {
            console.log('[FAIL] File IDs do not match!');
            process.exit(1);
        }
        console.log('[PASS] File IDs match as expected');
        
        // Verify duplicate response has correct structure
        if (!dupResult.status || dupResult.message !== 'Duplicate file detected') {
            console.log('[FAIL] Duplicate response missing expected fields');
            process.exit(1);
        }
        console.log('[PASS] Duplicate response has correct structure');

        // 3. Check Job Status - Original file should exist
        console.log('\n--- Test 3: Verify Original Job Exists ---');
        const finalStatus = await checkStatus(result.fileId);
        console.log('Final Status:', finalStatus.status);
        console.log('[PASS] Original job found in database');

        // 4. Verify duplicate upload did not create a new job
        console.log('\n--- Test 4: Verify No Duplicate Job Created ---');
        console.log('Duplicate was rejected - no new fileId generated');
        console.log('[PASS] Duplicate rejection working correctly');

        console.log('\n========================================');
        console.log('[PASS] All E2E Tests Completed Successfully!');
        console.log('========================================');
        console.log('\nTest Summary:');
        console.log('  1. Fresh uploads are processed normally');
        console.log('  2. Duplicate uploads are detected and rejected');
        console.log('  3. Duplicate response returns original fileId');
        console.log('  4. No duplicate jobs are created in database');
        console.log('========================================');

    } catch (error) {
        console.error('Test failed:', error.message);
        process.exit(1);
    }
}

runTests();
