# DynamoDB Streams - Aggregator Lambda Pattern

## Overview

The Document Status table uses **DynamoDB Streams** to automatically trigger the Aggregator Lambda when all chunks are processed. This keeps workers stateless and simple.

## How It Works

### 1. Worker Processing Flow
```typescript
// Worker processes a chunk
await processChunk(chunk);

// Store page attributes
await documentStatusService.savePageAttributes(fileId, tenantId, pageNumber, content);

// Increment processed pages counter (atomic operation)
await documentStatusService.incrementProcessedPages(fileId);
// This update triggers DynamoDB Streams
```

### 2. DynamoDB Streams Configuration

The Document Status table has streams enabled with `NEW_AND_OLD_IMAGES`:

```typescript
// When processedPages is updated, stream captures:
{
  eventName: 'MODIFY',
  dynamodb: {
    OldImage: { processedPages: 4, totalPages: 10 },
    NewImage: { processedPages: 5, totalPages: 10 }  // Not complete yet
  }
}

// When last chunk completes:
{
  eventName: 'MODIFY',
  dynamodb: {
    OldImage: { processedPages: 9, totalPages: 10 },
    NewImage: { processedPages: 10, totalPages: 10 }  // Complete!
  }
}
```

### 3. Lambda Event Source Mapping with Filter

The Aggregator Lambda has a **stream filter** that only triggers when complete:

```json
{
  "eventSourceArn": "arn:aws:dynamodb:region:account:table/DocumentOrchestrator/stream/...",
  "filterCriteria": {
    "filters": [{
      "pattern": "{\"dynamodb\": {\"NewImage\": {\"processedPages\": {\"N\": [{\"equals-ignore-case\": {\"dynamodb\": {\"NewImage\": {\"totalPages\": {\"N\": []}}}}}]}, \"SK\": {\"S\": [\"STATUS\"]}}}}"
    }]
  }
}
```

Simplified: Only invoke Lambda when:
- `SK == "STATUS"` (document status record, not page record)
- `processedPages == totalPages`
- `totalPages > 0` (Prevents premature trigger when both start at 0)
- `overallStatus == "processing"` (Ensures processing has actually started)

### 4. Aggregator Lambda Handler

```typescript
export async function handler(event: DynamoDBStreamEvent) {
  for (const record of event.Records) {
    if (record.eventName !== 'MODIFY') continue;
    
    const newImage = record.dynamodb.NewImage;
    const fileId = newImage.fileId.S;
    
    // Only process if complete
    if (newImage.processedPages.N === newImage.totalPages.N) {
      await aggregateResults(fileId);
    }
  }
}

async function aggregateResults(fileId: string) {
  // Retrieve all individual chunk results from DynamoDB to begin aggregation
  const pages = await documentStatusService.getDocumentPages(fileId);
  
  // Consolidate the analysis from all chunks into a single document
  const combined = combinePageResults(pages);
  
  // Persist the final aggregated JSON manifest to S3
  await s3.putObject({
    Bucket: 'results-bucket',
    Key: `${fileId}/final-result.json`,
    Body: JSON.stringify(combined)
  });
  
  // Transition the document status to 'completed' and record the results location
  await documentStatusService.updateDocumentStatus(fileId, {
    overallStatus: 'completed',
    completedAt: new Date().toISOString(),
    resultS3Key: `${fileId}/final-result.json`
  });
}
```

## Benefits of This Pattern

### Workers Stay Dumb
- Workers only know: "Process chunk - Store result - Increment counter"
- No coordination logic
- No polling or checking if done
- Stateless and scalable

### Orchestrator Stays Smart
- DynamoDB Streams acts as the orchestrator
- Automatic trigger when condition met
- No manual polling required
- Event-driven architecture

### Exactly-Once Semantics
- DynamoDB atomic increment ensures accurate count
- Stream guarantees delivery of updates
- Lambda processes each completion event once

### Cost Efficient
- No polling or continuous checking
- Lambda only runs when actually needed
- DynamoDB Streams included in table cost

## LocalStack Testing

DynamoDB Streams work in LocalStack too!

```bash
# Enable streams on table (already done in init script)
aws --endpoint-url=http://localhost:4566 dynamodb update-table \
  --table-name DocumentOrchestrator \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES

# Simulate worker increment
aws --endpoint-url=http://localhost:4566 dynamodb update-item \
  --table-name DocumentOrchestrator \
  --key '{"PK": {"S": "DOC#test-123"}, "SK": {"S": "STATUS"}}' \
  --update-expression "SET processedPages = processedPages + :inc" \
  --expression-attribute-values '{":inc": {"N": "1"}}'

# Check stream records
aws --endpoint-url=http://localhost:4566 dynamodbstreams list-streams
```

## Production Deployment

### SAM Template (infrastructure/template.yaml)

```yaml
DocumentTable:
  Type: AWS::DynamoDB::Table
  Properties:
    StreamSpecification:
      StreamViewType: NEW_AND_OLD_IMAGES  # Enable streams

AggregatorFunction:
  Type: AWS::Serverless::Function
  Properties:
    Handler: aggregator.handler
    Events:
      DynamoDBStream:
        Type: DynamoDB
        Properties:
          Stream: !GetAtt DocumentTable.StreamArn
          StartingPosition: LATEST
          FilterCriteria:
            Filters:
              - Pattern: '{"dynamodb": {"NewImage": {"SK": {"S": ["STATUS"]}}}}'
```

This pattern is production-ready and follows AWS best practices for event-driven architectures!
