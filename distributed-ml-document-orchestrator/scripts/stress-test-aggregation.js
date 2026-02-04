#!/usr/bin/env node
/**
 * Versioned Aggregation Stress Test
 * 
 * Tests the atomic aggregation locking under concurrent conditions:
 * 1. Tests claimAggregationLock() atomic conditional update
 * 2. Tests processingVersion page stamping
 * 3. Simulates race conditions with concurrent lock claims
 * 
 * Usage: node scripts/stress-test-aggregation.js
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'DocumentOrchestrator';
const CONCURRENT_ATTEMPTS = 10;
const TENANT_ID = 'stress-test-tenant';

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

// Simulates DocumentStatusService.createDocumentStatus
async function createDocumentStatus(fileId, totalPages) {
    await docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            PK: `DOC#${fileId}`,
            SK: 'STATUS',
            fileId,
            tenantId: TENANT_ID,
            overallStatus: 'processing',
            totalPages,
            processedPages: totalPages,
            aggregationVersion: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
    }));
}

// Simulates DocumentStatusService.claimAggregationLock
async function claimAggregationLock(fileId) {
    try {
        const result = await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `DOC#${fileId}`, SK: 'STATUS' },
            UpdateExpression: 'SET aggregationVersion = if_not_exists(aggregationVersion, :zero) + :one, overallStatus = :agg, updatedAt = :now',
            ConditionExpression: 'overallStatus = :processing',
            ExpressionAttributeValues: {
                ':zero': 0,
                ':one': 1,
                ':agg': 'aggregating',
                ':processing': 'processing',
                ':now': new Date().toISOString(),
            },
            ReturnValues: 'ALL_NEW',
        }));
        return { success: true, version: result.Attributes?.aggregationVersion ?? 1 };
    } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
            return { success: false, version: 0 };
        }
        throw error;
    }
}

// Simulates page save with processingVersion
async function savePageWithVersion(fileId, pageNumber, processingVersion) {
    await docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            PK: `DOC#${fileId}`,
            SK: `PAGE#${pageNumber.toString().padStart(4, '0')}`,
            fileId,
            tenantId: TENANT_ID,
            pageNumber,
            processingVersion,
            pageAnalysis: JSON.stringify({ content: `Page ${pageNumber} analysis` }),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
    }));
}

// Get all pages for a document
async function getDocumentPages(fileId) {
    const result = await docClient.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
            ':pk': `DOC#${fileId}`,
            ':sk': 'PAGE#',
        },
    }));
    return result.Items || [];
}

// Get document status
async function getDocumentStatus(fileId) {
    const result = await docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `DOC#${fileId}`, SK: 'STATUS' },
    }));
    return result.Item;
}

// Reset document to processing (for re-testing)
async function resetToProcessing(fileId) {
    await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `DOC#${fileId}`, SK: 'STATUS' },
        UpdateExpression: 'SET overallStatus = :status',
        ExpressionAttributeValues: {
            ':status': 'processing',
        },
    }));
}

// Cleanup
async function cleanup(fileId, totalPages) {
    try {
        await docClient.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: `DOC#${fileId}`, SK: 'STATUS' },
        }));
        for (let i = 1; i <= totalPages; i++) {
            await docClient.send(new DeleteCommand({
                TableName: TABLE_NAME,
                Key: { PK: `DOC#${fileId}`, SK: `PAGE#${i.toString().padStart(4, '0')}` },
            }));
        }
    } catch (e) { /* ignore cleanup errors */ }
}

async function runStressTest() {
    console.log('='.repeat(60));
    console.log('VERSIONED AGGREGATION STRESS TEST');
    console.log('='.repeat(60));
    console.log(`Concurrent attempts: ${CONCURRENT_ATTEMPTS}`);
    console.log(`Table: ${TABLE_NAME}`);
    console.log('');

    const fileId = `stress-agg-${Date.now()}`;
    const totalPages = 5;

    try {
        // TEST 1: Concurrent Lock Claims (Race Condition Test)
        console.log('[TEST 1] Concurrent Lock Claims');
        console.log('   Simulating multiple DynamoDB Stream triggers...');

        await createDocumentStatus(fileId, totalPages);

        // Fire N concurrent lock claims
        const lockResults = await Promise.all(
            Array(CONCURRENT_ATTEMPTS).fill(null).map(() => claimAggregationLock(fileId))
        );

        const successCount = lockResults.filter(r => r.success).length;
        const failCount = lockResults.filter(r => !r.success).length;

        console.log(`   Results: ${successCount} succeeded, ${failCount} failed`);

        if (successCount !== 1) {
            console.log(`[FAIL] Expected exactly 1 success, got ${successCount}`);
            process.exit(1);
        }
        console.log('[PASS] Exactly 1 lock acquired (atomic locking works!)');

        // Get the winning version
        const winningVersion = lockResults.find(r => r.success)?.version;
        console.log(`   Winning aggregationVersion: ${winningVersion}`);

        // TEST 2: Page Version Stamping
        console.log('\n[TEST 2] Page Version Stamping');

        // Simulate consumer stamping pages with processingVersion
        const processingVersion = 1;
        for (let i = 1; i <= totalPages; i++) {
            await savePageWithVersion(fileId, i, processingVersion);
        }
        console.log(`   Saved ${totalPages} pages with processingVersion=${processingVersion}`);

        const pages = await getDocumentPages(fileId);
        const correctVersionPages = pages.filter(p => p.processingVersion === processingVersion);

        if (correctVersionPages.length !== totalPages) {
            console.log(`[FAIL] Expected ${totalPages} pages with version ${processingVersion}, got ${correctVersionPages.length}`);
            process.exit(1);
        }
        console.log('[PASS] All pages have correct processingVersion');

        // TEST 3: Version Filtering
        console.log('\n[TEST 3] Version Filtering');

        // Simulate a stale page from a previous run
        await savePageWithVersion(fileId, 99, 0); // Old version
        const allPages = await getDocumentPages(fileId);
        const filteredPages = allPages.filter(p => p.processingVersion === winningVersion);

        console.log(`   Total pages: ${allPages.length}`);
        console.log(`   Filtered (version=${winningVersion}): ${filteredPages.length}`);

        if (filteredPages.length !== totalPages) {
            console.log(`[FAIL] Stale page was incorrectly included`);
            process.exit(1);
        }
        console.log('[PASS] Stale pages correctly filtered out');

        // TEST 4: Double-Fire Prevention After Lock
        console.log('\n[TEST 4] Double-Fire Prevention');

        // Status should now be 'aggregating', so another lock attempt should fail
        const secondLockAttempt = await claimAggregationLock(fileId);

        if (secondLockAttempt.success) {
            console.log('[FAIL] Lock was acquired twice!');
            process.exit(1);
        }
        console.log('[PASS] Second lock attempt correctly rejected');

        // TEST 5: Re-trigger After Reset
        console.log('\n[TEST 5] Re-trigger After Reset');

        await resetToProcessing(fileId);
        const retryLock = await claimAggregationLock(fileId);

        if (!retryLock.success) {
            console.log('[FAIL] Lock should succeed after reset');
            process.exit(1);
        }
        console.log(`[PASS] Lock re-acquired after reset (version=${retryLock.version})`);

        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('SUMMARY');
        console.log('='.repeat(60));
        console.log('[PASS] All versioned aggregation tests passed!');
        console.log('');
        console.log('Verified:');
        console.log('  ✓ Atomic locking prevents double-fire');
        console.log('  ✓ processingVersion correctly stamps pages');
        console.log('  ✓ Version filtering excludes stale pages');
        console.log('  ✓ Lock is re-acquirable after status reset');
        console.log('='.repeat(60));

    } finally {
        // Cleanup
        console.log('\n[CLEANUP] Cleaning up test data...');
        await cleanup(fileId, totalPages + 1); // +1 for the stale page
    }
}

runStressTest().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
