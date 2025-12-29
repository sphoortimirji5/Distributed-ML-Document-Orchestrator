# Local Development & Testing

This document provides instructions for setting up the Distributed ML Document Orchestrator in a local development environment using **LocalStack**, which provides a local emulation of AWS services.

## Quick Start

### Prerequisites
- **Node.js** 18+ and npm
- **Docker** and Docker Compose
- Gemini API Key ([Get one here](https://ai.google.dev/))

### 1. Environment Setup

Create a `.env` file in the root by copying `.env.example` and filling in your `GEMINI_API_KEY`.

### 2. Start LocalStack

```bash
docker-compose up -d
```

### 3. Initialize Resources

```bash
npm run init:local
```

### 4. Run Services

```bash
# Start all services
npm run dev

# Or start individually
npm run dev:api-gateway    # Port 3005
```

## Testing

### Unit Tests
```bash
npm run test
```

### Integration Tests
```bash
npm run test:integration
```

### E2E Tests
The project includes a comprehensive E2E test script that verifies both synchronous and asynchronous processing workflows.

1. **Start the Application**:
   ```bash
   npm run dev:api-gateway
   ```
2. **Run the E2E Script**:
   ```bash
   cd distributed-ml-document-orchestrator
   node scripts/e2e-test.js
   ```

## Test Coverage

The project includes unit, integration, and E2E tests to ensure system reliability.

### Unit & Integration Tests
These tests run against LocalStack to verify AWS service integrations.

- **Storage (S3)**:
  - PDF uploads and downloads.
  - File existence and metadata checks.
  - Presigned URL generation (Upload/Download).
  - Result JSON storage and file deletion.
- **Messaging (Kinesis)**:
  - Stream health and status checks.
  - Event publishing (Upload, Chunk, and Batch events).
  - Batch size limit validation.
- **Database (DynamoDB)**:
  - **File Metadata**: Lifecycle management of file records (Save, Get, Update Status, Delete).
  - **Document Status**: Tracking processing progress, page-level analysis storage, and tenant-based queries.
- **API (NestJS)**:
  - Controller routing and basic service logic.

### E2E Tests
The E2E suite verifies the entire document processing pipeline:
1. **Upload**: Submits a PDF to the API.
2. **Orchestration**: Verifies the job is routed to the correct workflow.
3. **Processing**: Simulates/waits for Gemini analysis and page-level updates.
4. **Aggregation**: Polls the status API until the document is marked as `completed`.
5. **Verification**: Confirms the final aggregated results are available in S3.
