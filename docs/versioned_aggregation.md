# Versioned Aggregation

This document explains the versioning system that ensures reliable document aggregation in the face of retries, failures, and race conditions.

## Overview

| Field | Location | Set By | Purpose |
|-------|----------|--------|---------|
| `processingVersion` | Page records | Consumer | "Which processing run created this page?" |
| `aggregationVersion` | Document status | Aggregator | "How many aggregation attempts?" |

**Key Relationship:**
```
processingVersion = aggregationVersion + 1
```

---

## When Aggregation is Triggered

```
┌─────────────────────────────────────────────────────────┐
│  Consumer processes each page                           │
│    └── incrementProcessedPages() after each page        │
│                                                          │
│  When: processedPages == totalPages                      │
│    └── DynamoDB Stream triggers Aggregator Lambda        │
│                                                          │
│  Aggregator calls: claimAggregationLock()                │
│    └── Atomic increment of aggregationVersion            │
│    └── Status: 'processing' → 'aggregating'              │
└─────────────────────────────────────────────────────────┘
```

---

## Version Calculation

### Consumer (Page Processing)

```typescript
const status = await getDocumentStatus(fileId);
const processingVersion = (status?.aggregationVersion ?? 0) + 1;

// All pages in this run get the same processingVersion
savePageAttributes(fileId, pageNumber, analysis, processingVersion);
```

### Aggregator (Aggregation)

```typescript
const lock = await claimAggregationLock(fileId);
// aggregationVersion atomically incremented: 0 → 1

const pages = allPages.filter(p => p.processingVersion === lock.version);
// Only include pages matching current aggregationVersion
```

---

## Normal Flow

```
Document uploaded (aggregationVersion = 0)
        │
        ▼
Consumer reads aggregationVersion = 0
Consumer computes processingVersion = 0 + 1 = 1
        │
        ├── Page 1 saved: processingVersion = 1
        ├── Page 2 saved: processingVersion = 1
        └── processedPages = 2/2 → triggers aggregation
                │
                ▼
Aggregator claims lock → aggregationVersion = 1
Aggregator filters: processingVersion == 1? ✅
        │
        ▼
Final JSON uploaded to S3 (includes both pages)
Status: 'completed'
```

---

## Failure Modes

### 1. Page Analysis Fails

```
Page 1: processingVersion = 1, actual analysis ✅
Page 2: processingVersion = 1, error placeholder ❌
        │
        ▼
Aggregation still triggers (processedPages == totalPages)
Final JSON includes page 2 with error content
```

**Result:** Document completes with partial results.

---

### 2. Aggregation Fails (S3 Upload Error)

```
Run 1:
  Pages: processingVersion = 1
  Aggregator: aggregationVersion = 1
  S3 upload fails → status reset to 'processing'
        │
        ▼
Run 2 (retry):
  Aggregator: aggregationVersion = 1 → 2
  Filter: processingVersion == 2?
  Pages have processingVersion = 1 → NO MATCH ❌
```

**Result:** Aggregation deferred. Document must be reprocessed.

---

### 3. Double Aggregation Fire (Race Condition)

```
DynamoDB Stream fires twice (duplicate trigger)
        │
        ├── Aggregator 1: claimAggregationLock() → SUCCESS (version 1)
        └── Aggregator 2: claimAggregationLock() → FAILS
                │
                └── ConditionalCheckFailedException
                    (status already 'aggregating')
```

**Result:** Only one aggregator proceeds. Race condition prevented.

---

### 4. Late Page Retry (After Completion)

```
Document completed: status = 'completed'
        │
        ▼
Kinesis redelivers page message (late retry)
        │
        ▼
Consumer checks status:
  if (status === 'completed' || status === 'failed') {
      return; // Skip processing
  }
```

**Result:** Late retry safely ignored.

---

### 5. Document Reprocessed

```
Run 1:
  processingVersion = 1, aggregationVersion = 1
  Completed with errors
        │
        ▼
Operator triggers reprocess
        │
        ▼
Run 2:
  Consumer: processingVersion = 1 + 1 = 2
  All pages saved with processingVersion = 2
  
  Aggregator: aggregationVersion = 1 + 1 = 2
  Filter: processingVersion == 2 ✅
```

**Result:** Fresh aggregation with new pages.

---

## DynamoDB Record Structure

### Document Status (SK = STATUS)
```json
{
  "PK": "DOC#abc-123",
  "SK": "STATUS",
  "overallStatus": "completed",
  "totalPages": 2,
  "processedPages": 2,
  "aggregationVersion": 1,
  "resultS3Key": "results/abc-123.json"
}
```

### Page Record (SK = PAGE#0001)
```json
{
  "PK": "DOC#abc-123",
  "SK": "PAGE#0001",
  "pageNumber": 1,
  "processingVersion": 1,
  "pageAnalysis": "{\"entities\": [...], \"summary\": \"...\"}"
}
```

---

## Atomic Lock Implementation

```typescript
async claimAggregationLock(fileId: string) {
    const result = await dynamoClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `DOC#${fileId}`, SK: 'STATUS' },
        UpdateExpression: 'SET aggregationVersion = aggregationVersion + :one, 
                              overallStatus = :agg',
        ConditionExpression: 'overallStatus = :processing',
        ExpressionAttributeValues: {
            ':one': 1,
            ':agg': 'aggregating',
            ':processing': 'processing'
        },
        ReturnValues: 'ALL_NEW'
    }));
    return { success: true, version: result.Attributes.aggregationVersion };
}
```

The `ConditionExpression` ensures only one aggregator can claim the lock.

---

## Reaper Service (Stuck Document Recovery)

Documents can get stuck if the consumer crashes mid-processing or pages go to DLQ. The Reaper service automatically detects and handles these cases.

### Configuration

```
Check interval: Every 5 minutes
Stuck threshold: 30 minutes (no progress)
Action: Mark document as 'failed'
```

### How It Works

```typescript
// Scan for stuck documents
const stuckDocuments = await getStuckDocuments(30 * 60 * 1000);

// Mark each as failed
for (const doc of stuckDocuments) {
    await updateStatus(doc.fileId, doc.tenantId, 'failed', 
        'Reaper: Document stuck in processing');
}
```

### What Gets Detected

| Condition | Action |
|-----------|--------|
| `status = 'processing'` for > 30 mins | Mark as `failed` |
| `processedPages < totalPages` | Indicates incomplete processing |
| `updatedAt` not changing | Indicates no progress |

---

## Summary

| Scenario | processingVersion | aggregationVersion | Outcome |
|----------|-------------------|-------------------|---------|
| Normal | 1 | 1 | Match ✅ |
| Page failure | 1 | 1 | Match ✅ (with error) |
| Aggregation retry | 1 | 2 | Mismatch ❌ → reprocess |
| Double trigger | 1 | 1 | One wins, one skips |
| Late retry | — | — | Guard skips |
| Reprocess | 2 | 2 | Match ✅ |
