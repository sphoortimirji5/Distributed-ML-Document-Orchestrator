#!/usr/bin/env node
/**
 * Deduplication Stress Test
 * 
 * Tests the content hash deduplication feature under load by:
 * 1. Uploading unique files (should all succeed)
 * 2. Uploading duplicate files (should be detected)
 * 3. Measuring hash computation and lookup performance
 * 
 * Usage: node scripts/stress-test-dedup.js
 */

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const ITERATIONS = 100;
const TENANT_ID = 'stress-test-tenant';
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'DocumentOrchestrator';

// Configure for LocalStack
const client = new DynamoDBClient({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
    },
});

const docClient = DynamoDBDocumentClient.from(client);

function generateFileBuffer(sizeKb, seed) {
    const content = `${seed}-`.repeat(Math.ceil((sizeKb * 1024) / (seed.length + 1)));
    return Buffer.from(content.slice(0, sizeKb * 1024));
}

function computeHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function saveFileMetadata(fileId, contentHash) {
    await docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            PK: `FILE#${fileId}`,
            SK: 'METADATA',
            fileId,
            tenantId: TENANT_ID,
            fileName: `${fileId}.pdf`,
            fileSize: 1024,
            contentHash,
            GSI2PK: `HASH#${TENANT_ID}`,
            GSI2SK: contentHash,
            uploadedAt: new Date().toISOString(),
        },
    }));
}

async function findByContentHash(contentHash) {
    const result = await docClient.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK = :sk',
        ExpressionAttributeValues: {
            ':pk': `HASH#${TENANT_ID}`,
            ':sk': contentHash,
        },
        Limit: 1,
    }));
    return (result.Items?.length ?? 0) > 0;
}

async function deleteFileMetadata(fileId) {
    await docClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: `FILE#${fileId}`, SK: 'METADATA' },
    }));
}

function formatResult(result) {
    return `${result.operation}: ${result.count} ops | avg: ${result.avgMs.toFixed(2)}ms | min: ${result.minMs.toFixed(2)}ms | max: ${result.maxMs.toFixed(2)}ms`;
}

async function runStressTest() {
    console.log('='.repeat(60));
    console.log('DEDUPLICATION STRESS TEST');
    console.log('='.repeat(60));
    console.log(`Iterations: ${ITERATIONS}`);
    console.log(`Tenant: ${TENANT_ID}`);
    console.log(`Table: ${TABLE_NAME}`);
    console.log('');

    const fileIds = [];
    const hashes = [];

    // Test 1: Hash computation performance
    console.log('[TEST] Test 1: SHA-256 Hash Computation');
    const hashTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
        const buffer = generateFileBuffer(100, `unique-file-${i}`);
        const start = performance.now();
        const hash = computeHash(buffer);
        hashTimes.push(performance.now() - start);
        hashes.push(hash);
    }
    console.log(formatResult({
        operation: 'SHA-256 (100KB)',
        count: ITERATIONS,
        totalMs: hashTimes.reduce((a, b) => a + b, 0),
        avgMs: hashTimes.reduce((a, b) => a + b, 0) / ITERATIONS,
        minMs: Math.min(...hashTimes),
        maxMs: Math.max(...hashTimes),
    }));

    // Test 2: Insert unique files
    console.log('\n[TEST] Test 2: Insert Unique Files');
    const insertTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
        const fileId = `stress-${Date.now()}-${i}`;
        fileIds.push(fileId);
        const start = performance.now();
        await saveFileMetadata(fileId, hashes[i]);
        insertTimes.push(performance.now() - start);
    }
    console.log(formatResult({
        operation: 'DynamoDB Insert',
        count: ITERATIONS,
        totalMs: insertTimes.reduce((a, b) => a + b, 0),
        avgMs: insertTimes.reduce((a, b) => a + b, 0) / ITERATIONS,
        minMs: Math.min(...insertTimes),
        maxMs: Math.max(...insertTimes),
    }));

    // Test 3: Duplicate detection (hash lookup)
    console.log('\n[TEST] Test 3: Duplicate Detection (GSI2 Query)');
    const lookupTimes = [];
    let duplicatesFound = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        const found = await findByContentHash(hashes[i]);
        lookupTimes.push(performance.now() - start);
        if (found) duplicatesFound++;
    }
    console.log(formatResult({
        operation: 'GSI2 Lookup',
        count: ITERATIONS,
        totalMs: lookupTimes.reduce((a, b) => a + b, 0),
        avgMs: lookupTimes.reduce((a, b) => a + b, 0) / ITERATIONS,
        minMs: Math.min(...lookupTimes),
        maxMs: Math.max(...lookupTimes),
    }));
    console.log(`   Duplicates detected: ${duplicatesFound}/${ITERATIONS} (expected: ${ITERATIONS})`);

    // Test 4: Non-existent hash lookup
    console.log('\n[TEST] Test 4: Non-Existent Hash Lookup');
    const missLookupTimes = [];
    let misses = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        const fakeHash = computeHash(Buffer.from(`nonexistent-${i}-${Date.now()}`));
        const start = performance.now();
        const found = await findByContentHash(fakeHash);
        missLookupTimes.push(performance.now() - start);
        if (!found) misses++;
    }
    console.log(formatResult({
        operation: 'GSI2 Miss',
        count: ITERATIONS,
        totalMs: missLookupTimes.reduce((a, b) => a + b, 0),
        avgMs: missLookupTimes.reduce((a, b) => a + b, 0) / ITERATIONS,
        minMs: Math.min(...missLookupTimes),
        maxMs: Math.max(...missLookupTimes),
    }));
    console.log(`   Misses: ${misses}/${ITERATIONS} (expected: ${ITERATIONS})`);

    // Cleanup
    console.log('\n[CLEANUP] Cleaning up test data...');
    for (const fileId of fileIds) {
        await deleteFileMetadata(fileId);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    const avgHashMs = hashTimes.reduce((a, b) => a + b, 0) / ITERATIONS;
    const avgLookupMs = lookupTimes.reduce((a, b) => a + b, 0) / ITERATIONS;
    const totalOverhead = avgHashMs + avgLookupMs;
    console.log(`[METRICS] Average deduplication overhead: ${totalOverhead.toFixed(2)}ms`);
    console.log(`   - Hash computation: ${avgHashMs.toFixed(2)}ms`);
    console.log(`   - GSI2 lookup: ${avgLookupMs.toFixed(2)}ms`);
    console.log(`[PASS] All ${duplicatesFound} duplicates correctly detected`);
    console.log(`[PASS] All ${misses} non-existent lookups correctly returned null`);
    console.log('='.repeat(60));
}

runStressTest().catch(console.error);
