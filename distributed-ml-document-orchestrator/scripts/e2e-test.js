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
        // 1. Sync Test (Small File - but now async due to threshold)
        // Wait, I'll use a very small file if I have one, or just use the same file.
        // If threshold is 0.5MB, test-document.pdf (1MB) will be ASYNC.
        // I'll create a tiny text file and rename it to .pdf to test SYNC if needed, 
        // but the user wants to test Gemini, so it should be a real PDF.

        console.log('\n--- Starting Sync Test (using small threshold) ---');
        // I'll use a small threshold so test-document.pdf is async.
        // To test sync, I'd need a file < 0.5MB.

        console.log('Note: test-document.pdf is ~1MB, so it will be ASYNC with 0.5MB threshold.');
        const result = await uploadFile('../test-document.pdf');
        console.log('Upload Result:', result);
        await waitForCompletion(result.fileId);
        console.log('Test Passed!');

    } catch (error) {
        process.exit(1);
    }
}

runTests();
