# Testing Strategy

## Testing Philosophy
Correctness in this system means that every document uploaded is either fully processed or explicitly failed with a recoverable state. Local tests validate the logic and integration with emulated AWS services, but they cannot validate production-scale throughput or real-world network jitter.

## Unit Tests
- **Logic Tested**: PDF chunking algorithms, metadata validation, Gemini response parsing, and state machine transitions.
- **Expectation**: 100% deterministic behavior. No network calls or AWS dependencies.
- **Command**: `npm run test`

## Integration Tests
- **Flows Validated**: End-to-end document lifecycle using LocalStack (S3, DynamoDB, Kinesis).
- **Behavior**: Verifies idempotency (re-processing the same chunk) and retry logic for simulated transient failures.
- **Command**: `npm run test:integration`

## Load / Stress Tests (Local)
- **Purpose**: Validate system behavior under pressure, not absolute performance metrics.
- **Tested**: Burst handling (10+ concurrent uploads), queue growth monitoring, and backpressure triggers.
- **Out of Scope**: Latency benchmarks, AWS service limits, or Availability Zone failures.

## Failure Injection
- **Simulation**: Manual termination of consumer tasks, simulated Gemini 429/500 errors, and Kinesis stream throttling.
- **Expected Response**: System must checkpoint progress and resume without duplicating results or losing data.

## Production Validation (Out of Scope Locally)
- **Scale**: Real-world scale and SLOs are validated in the staging/production environments using AWS CloudWatch Metrics.
- **Metrics**: 
    - `Kinesis.GetRecords.IteratorAgeMilliseconds` (Processing lag)
    - `Gemini.API.ErrorRate`
    - `Job.CompletionTime.P99`

---
**Note**: Local tests are for functional verification. Performance claims are only valid when measured against production-grade infrastructure.
