# Local Development Guide

This document provides instructions for setting up the Distributed ML Document Orchestrator in a local development environment using **LocalStack**, which provides a local emulation of AWS services.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Runtime |
| npm | 9+ | Package manager |
| Docker | 24.x+ | LocalStack containers |
| Docker Compose | 2.x+ | Multi-container orchestration |
| Gemini API Key | - | ML processing ([Get one here](https://ai.google.dev/)) |

> **Note on LLM Providers**: Local development uses **Google Gemini** (API key required). For production, **AWS Bedrock** is recommended (IAM authentication, no API key). See [PRODUCTION.md](PRODUCTION.md#llm-provider-configuration) for details.

## Environment Setup

Create a `.env` file by copying the template:

```bash
cp .env.example .env
```

Required variables:

```env
# AWS Configuration (LocalStack)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_ENDPOINT_URL=http://localhost:4566

# S3 Configuration
S3_BUCKET_NAME=document-orchestrator-pdfs
S3_RESULTS_BUCKET=document-orchestrator-results

# DynamoDB Configuration
DYNAMODB_TABLE_NAME=DocumentOrchestrator
DYNAMODB_ENDPOINT=http://localhost:4566

# Kinesis Configuration
KINESIS_STREAM_NAME=document-processing-stream
KINESIS_ENDPOINT=http://localhost:4566

# Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-flash

# Application Configuration
NODE_ENV=development
PORT=3005
FILE_SIZE_THRESHOLD_MB=0.5
```

## Quick Start

### 1. Start LocalStack

```bash
docker-compose up -d
```

The `docker-compose.yml` provides:
- LocalStack with S3, DynamoDB, and Kinesis
- Persistent volume for data

### 2. Initialize AWS Resources

```bash
npm run init:local
```

This creates:
- S3 buckets for PDFs and results
- DynamoDB table with GSI and Streams
- Kinesis stream for event processing

### 3. Verify LocalStack

```bash
# Check S3 buckets
aws --endpoint-url=http://localhost:4566 s3 ls

# Check DynamoDB tables
aws --endpoint-url=http://localhost:4566 dynamodb list-tables

# Check Kinesis streams
aws --endpoint-url=http://localhost:4566 kinesis list-streams
```

### 4. Run the Application

```bash
# Start all services
npm run dev

# Or start individually
npm run dev:api-gateway    # Port 3005
```

## Git Hooks (Recommended)

Install git hooks to run tests automatically before pushing:

```bash
./scripts/setup-git-hooks.sh
```

This installs a pre-push hook that runs:
1. Unit tests (`npm test`)
2. Production build (`npm run build`)

If tests fail, the push is aborted.

**Skip hooks (emergencies only):**
```bash
git push --no-verify
```

## Testing

### Unit Tests

```bash
npm run test
npm run test:cov  # With coverage
```

### Integration Tests

```bash
# Requires LocalStack running
npm run test:integration
```

### E2E Tests

The project includes a comprehensive E2E test script that verifies both synchronous and asynchronous processing workflows.

1. **Start the Application**:
   ```bash
   npm run dev:api-gateway
   ```

   > **Tip**: If NX watch mode causes restarts during testing, use ts-node directly for stability:
   > ```bash
   > cd distributed-ml-document-orchestrator
   > npx ts-node --project apps/distributed-ml-document-orchestrator/tsconfig.app.json \
   >   apps/distributed-ml-document-orchestrator/src/main.ts
   > ```

2. **Run the E2E Script**:
   ```bash
   cd distributed-ml-document-orchestrator
   node scripts/e2e-test.js
   ```

## Test Coverage

### Unit & Integration Tests

| Component | Tests Covered |
|-----------|---------------|
| **Storage (S3)** | Upload, download, presigned URLs, file deletion |
| **Messaging (Kinesis)** | Stream health, event publishing, batch validation |
| **Database (DynamoDB)** | File metadata CRUD, status tracking, tenant queries |
| **API (NestJS)** | Controller routing, request validation |

### E2E Tests

The E2E suite verifies the entire document processing pipeline:
1. **Upload**: Submits a PDF to the API
2. **Orchestration**: Verifies job routing to correct workflow
3. **Processing**: Simulates/waits for Gemini analysis
4. **Aggregation**: Polls until document marked `completed`
5. **Verification**: Confirms results available in S3

## API Testing

### Health Check

```bash
curl http://localhost:3005/health
```

### Upload Document

```bash
curl -X POST http://localhost:3005/upload \
  -H "Content-Type: multipart/form-data" \
  -H "x-tenant-id: tenant-123" \
  -F "file=@test-document.pdf"
```

### Check Job Status

```bash
curl http://localhost:3005/jobs/{jobId} \
  -H "x-tenant-id: tenant-123"
```

## Debugging

### VS Code Launch Configuration

Add to `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "attach",
      "name": "Attach NestJS",
      "port": 9229,
      "restart": true
    }
  ]
}
```

### Enable Debug Logging

```env
LOG_LEVEL=debug
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 4566 in use | `docker-compose down` or `lsof -i :4566` |
| Port 3005 in use | `lsof -i :3005` and kill the process |
| LocalStack not responding | Verify Docker: `docker ps \| grep localstack` |
| Kinesis ShardIterator expired | Consumer hasn't polled in >5 min; restart consumer |
| S3 bucket not found | Run `npm run init:local` to create resources |
| DynamoDB table not found | Run `npm run init:local` to create resources |
| Gemini 429 errors | Check API key quota at console.cloud.google.com |
| Connection refused | Ensure `docker-compose up -d` is running |

## Local vs. Production

| Aspect | Local | Production |
|--------|-------|------------|
| **AWS Services** | LocalStack (emulated) | Real AWS |
| **Credentials** | Static test keys | IAM Task Roles |
| **Secrets** | `.env` file | SSM Parameter Store |
| **Networking** | Docker bridge | VPC with private subnets |
| **Logging** | Console (pretty) | CloudWatch (JSON) |

---
**Note**: Local tests are for functional verification. Performance claims are only valid when measured against production-grade infrastructure.
