const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const API_URL = 'http://127.0.0.1:3005/api';
const TENANT_ID = 'test-tenant';

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
        // 1. Upload Test
        console.log('\n--- Starting Upload Test ---');
        console.log('Note: test-document.pdf is ~1MB, so it will be ASYNC with 0.5MB threshold.');
        const result = await uploadFile('../test-document.pdf');
        console.log('Upload Result:', result);

        // 2. Deduplication Test
        console.log('\n--- Starting Deduplication Test ---');
        console.log('Re-uploading the same file...');
        const dupResult = await uploadFile('../test-document.pdf');
        console.log('Duplicate Upload Result:', dupResult);

        if (dupResult.duplicate === true) {
            console.log('✅ Deduplication Test PASSED - Duplicate correctly detected!');
            console.log(`   Original fileId: ${result.fileId}`);
            console.log(`   Returned fileId: ${dupResult.fileId}`);
            if (dupResult.fileId === result.fileId) {
                console.log('✅ File IDs match as expected');
            } else {
                console.log('⚠️  File IDs differ - checking if this is expected');
            }
        } else {
            console.log('❌ Deduplication Test FAILED - File was processed again');
            console.log('   Expected: { duplicate: true }');
            console.log('   Got:', dupResult);
        }

        // 3. Wait for original file to complete (if needed)
        console.log('\n--- Checking Job Status ---');
        const finalStatus = await checkStatus(result.fileId);
        console.log('Final Status:', finalStatus.status);

        console.log('\n✅ All E2E Tests Completed!');

    } catch (error) {
        console.error('Test failed:', error.message);
        process.exit(1);
    }
}

runTests();
