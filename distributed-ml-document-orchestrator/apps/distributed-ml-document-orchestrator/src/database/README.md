# NestJS DynamoDB Services - Local Testing Guide

This directory contains DynamoDB services for managing file metadata and document status with page-level attributes.

## Table Design

We use a **single-table design** pattern in DynamoDB with the following entity types:

### 1. File Metadata Table
Stores information about uploaded PDF files.

**Primary Key:**
- `PK`: `FILE#<fileId>`
- `SK`: `METADATA`

**GSI1 (for tenant queries):**
- `GSI1PK`: `TENANT#<tenantId>`
- `GSI1SK`: `FILE#<uploadedAt>`

**Attributes:**
- `fileId`, `fileName`, `fileSize`, `mimeType`
- `s3Key`, `s3Bucket`
- `tenantId`, `userId`
- `processingType` (sync/async)
- `status` (uploaded/processing/completed/failed)
- `uploadedAt`, `updatedAt`
- `ttl` (auto-cleanup after 90 days)

### 2. Document Status Table
Stores document processing status and page-level attributes.

**Primary Key (Status Record):**
- `PK`: `DOC#<fileId>`
- `SK`: `STATUS`

**Primary Key (Page Record):**
- `PK`: `DOC#<fileId>`
- `SK`: `PAGE#<pageNumber>` (zero-padded, e.g., PAGE#0001)

**GSI1 (for tenant status queries):**
- `GSI1PK`: `TENANT#<tenantId>#STATUS`
- `GSI1SK`: `<updatedAt>`

**Status Attributes:**
- `overallStatus` (pending/chunking/processing/aggregating/completed/failed)
- `totalPages`, `processedPages`, `failedPages`
- `startedAt`, `completedAt`, `errorMessage`
- `resultS3Key`

**Page Attributes:**
- `pageNumber`, `pageContent`
- `chunkIds` (array of chunk identifiers)

## Running Local Tests

### 1. Start LocalStack

```bash
# From project root
cd ../..
docker-compose up -d
```

This will:
- Start LocalStack on port 4566
- Automatically create the DynamoDB table
- Create S3 buckets and Kinesis stream

### 2. Verify LocalStack is Running

```bash
# Check LocalStack status
docker-compose ps

# View LocalStack logs
docker-compose logs localstack

# Access LocalStack dashboard
open http://localhost:4567
```

### 3. Verify DynamoDB Table

```bash
# List tables
aws --endpoint-url=http://localhost:4566 dynamodb list-tables

# Describe table
aws --endpoint-url=http://localhost:4566 dynamodb describe-table \
  --table-name DocumentOrchestrator
```

### 4. Run Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- database.service.spec

# Run tests in watch mode
npm test -- --watch
```

## Test Coverage

The test suite covers:

### FileMetadataService
-  Save file metadata
-  Retrieve file metadata by ID
-  Update file status
-  Query files by tenant
-  Delete file metadata

### DocumentStatusService
-  Create document status
-  Retrieve document status
-  Update document status
-  Save page attributes
-  Retrieve specific page
-  Retrieve all document pages
-  Increment processed pages counter
-  Query documents by tenant

## Manual Testing with AWS CLI

### File Metadata Operations

```bash
# Put file metadata
aws --endpoint-url=http://localhost:4566 dynamodb put-item \
  --table-name DocumentOrchestrator \
  --item '{
    "PK": {"S": "FILE#test-123"},
    "SK": {"S": "METADATA"},
    "fileId": {"S": "test-123"},
    "fileName": {"S": "document.pdf"},
    "fileSize": {"N": "1024000"},
    "tenantId": {"S": "tenant-1"},
    "status": {"S": "uploaded"}
  }'

# Get file metadata
aws --endpoint-url=http://localhost:4566 dynamodb get-item \
  --table-name DocumentOrchestrator \
  --key '{"PK": {"S": "FILE#test-123"}, "SK": {"S": "METADATA"}}'

# Query files by tenant
aws --endpoint-url=http://localhost:4566 dynamodb query \
  --table-name DocumentOrchestrator \
  --index-name GSI1 \
  --key-condition-expression "GSI1PK = :gsi1pk" \
  --expression-attribute-values '{":gsi1pk": {"S": "TENANT#tenant-1"}}'
```

### Document Status Operations

```bash
# Put document status
aws --endpoint-url=http://localhost:4566 dynamodb put-item \
  --table-name DocumentOrchestrator \
  --item '{
    "PK": {"S": "DOC#test-123"},
    "SK": {"S": "STATUS"},
    "fileId": {"S": "test-123"},
    "tenantId": {"S": "tenant-1"},
    "overallStatus": {"S": "processing"},
    "totalPages": {"N": "10"},
    "processedPages": {"N": "5"}
  }'

# Put page attributes
aws --endpoint-url=http://localhost:4566 dynamodb put-item \
  --table-name DocumentOrchestrator \
  --item '{
    "PK": {"S": "DOC#test-123"},
    "SK": {"S": "PAGE#0001"},
    "fileId": {"S": "test-123"},
    "pageNumber": {"N": "1"},
    "pageContent": {"S": "Page 1 content here"}
  }'

# Query all pages for a document
aws --endpoint-url=http://localhost:4566 dynamodb query \
  --table-name DocumentOrchestrator \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{
    ":pk": {"S": "DOC#test-123"},
    ":sk": {"S": "PAGE#"}
  }'
```

## Troubleshooting

### LocalStack not responding
```bash
docker-compose restart localstack
docker-compose logs -f localstack
```

### Table not found
```bash
# Reinitialize LocalStack
docker-compose down
docker-compose up -d
# Wait 10 seconds for initialization
sleep 10
```

### Tests failing
```bash
# Ensure .env file exists
cp .env.example .env

# Verify environment variables
cat .env | grep DYNAMODB

# Check LocalStack endpoint
curl http://localhost:4566/_localstack/health
```

## Production Deployment

For production, simply remove or comment out the `AWS_ENDPOINT_URL` in your `.env`:

```bash
# .env.production
AWS_REGION=us-east-1
# AWS_ENDPOINT_URL=  # Comment out for production
DYNAMODB_TABLE_NAME=DocumentOrchestrator-Prod
```

The same code will work with real AWS DynamoDB!
