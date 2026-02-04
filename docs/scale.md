# Scalability & Failure Modes

This document covers how the system achieves scalability and handles failures at scale.

## Table of Contents

- [How Scalability is Achieved](#how-scalability-is-achieved)
- [Scale & Limits](#scale--limits)
- [Failure Modes](#failure-modes)

---

## How Scalability is Achieved

### 1. Parallel Page Processing

Each PDF page is processed independently. A 100-page document spawns 100 parallel ML API calls, reducing latency from O(n) to O(1) per job.

```typescript
// pages are processed in parallel, not sequentially
await Promise.all(pages.map(page => this.geminiService.analyze(page)));
```

### 2. Kinesis Partition Keys

Jobs are partitioned by `jobId`, ensuring ordered processing within a job while allowing parallelism across jobs.

```typescript
await kinesis.putRecord({
  StreamName: STREAM_NAME,
  PartitionKey: jobId, // All pages for same job go to same shard
  Data: JSON.stringify(event),
});
```

### 3. Idempotency via DynamoDB

`jobId + pageNumber` composite keys prevent duplicate results. Re-processed events overwrite rather than append.

```typescript
// Idempotent write - same key = update, not duplicate
await dynamodb.put({
  TableName: TABLE,
  Item: { PK: `JOB#${jobId}`, SK: `PAGE#${pageNumber}`, ...result }
});
```

### 4. Backpressure Management

Consumer concurrency is throttled via semaphores to respect ML API rate limits.

```typescript
const semaphore = new Semaphore(MAX_CONCURRENT_GEMINI_CALLS);
await semaphore.acquire();
try {
  await gemini.analyze(page);
} finally {
  semaphore.release();
}
```

---

## Scale & Limits

| Metric | Expected Value |
|--------|----------------|
| **Concurrent uploads** | 100+ |
| **Throughput (small docs)** | ~50 docs/min |
| **Pages per document** | Up to 500 |
| **First bottleneck** | ML API rate limits (RPM/TPM) |
| **Kinesis shards** | 1 (scales to 10+) |
| **Fargate tasks** | 1-10 (auto-scaled) |

### Non-Goals

- Real-time <1s latency for 100+ page documents
- OCR for handwritten text (relies on ML vision capabilities)

---

## Failure Modes

| Failure | System Response | Recovery |
|---------|-----------------|----------|
| **ML API Timeout** | Consumer retries with exponential backoff | Automatic via Kinesis retry policy |
| **Consumer Crash** | Kinesis checkpointing ensures no data loss | New ECS task picks up from last checkpoint |
| **S3 Outage** | API returns 503; ingestion halts | Manual retry once AWS service restores |
| **DynamoDB Throttle** | On-demand billing auto-scales | Automatic; monitor `UserErrors` metric |
| **Kinesis Shard Exhaustion** | Iterator age increases | Scale shards or reduce producer rate |
| **Lambda Throttle** | Aggregator retries with exponential backoff | Automatic; monitor `Throttles` metric |

### Circuit Breaker Pattern

For production deployments, consider implementing circuit breakers:

```typescript
// Example: Circuit breaker for ML API calls
if (consecutiveFailures > THRESHOLD) {
  await sleep(CIRCUIT_BREAKER_DELAY);
  // Alert on-call engineer
}
```

### Monitoring at Scale

Key metrics to watch:

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| `Kinesis.IteratorAge` | >60 seconds | Scale shards or consumers |
| `ML_API.ErrorRate` | >5% | Check API quota, implement backoff |
| `DynamoDB.UserErrors` | >10/min | Check IAM permissions, throttling |
| `ECS.CPUUtilization` | >80% | Scale Fargate tasks |

---

## Scaling Configuration

### ECS Auto Scaling

```yaml
# Target tracking based on CPU utilization
ScalingPolicy:
  TargetValue: 70
  ScaleInCooldown: 300
  ScaleOutCooldown: 60
  PredefinedMetricType: ECSServiceAverageCPUUtilization

# Min/Max tasks
DesiredCount: 2
MinCapacity: 1
MaxCapacity: 10
```

### Lambda Concurrency

| Function | Reserved Concurrency | Rationale |
|----------|---------------------|-----------|
| Worker | 50 | Match Gemini API rate limits |
| Aggregator | 10 | Low-frequency, triggered by completions |

### Kinesis Scaling

| Shards | Throughput | When to Scale |
|--------|------------|---------------|
| 1 | 1 MB/s write, 2 MB/s read | Default |
| 5 | 5 MB/s write, 10 MB/s read | >100 concurrent uploads |
| 10 | 10 MB/s write, 20 MB/s read | High-volume batch processing |

---

## Related Documentation

- [Production Deployment Guide](../docs/PRODUCTION.md)
- [Observability & Monitoring](../docs/observability.md)
- [Architecture Overview](../README.md#architecture)
