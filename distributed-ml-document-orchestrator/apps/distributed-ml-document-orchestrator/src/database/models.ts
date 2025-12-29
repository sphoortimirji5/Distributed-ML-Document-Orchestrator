/**
 * Represents the metadata and storage information for an uploaded PDF document.
 */
export interface FileMetadata {
    // Primary Key
    PK: string; // Format: FILE#<fileId>
    SK: string; // Format: METADATA

    // File Information
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    s3Key: string;
    s3Bucket: string;

    // Tenant Information
    tenantId: string;
    userId?: string;

    // Processing Information
    processingType: 'sync' | 'async';
    status: 'uploaded' | 'processing' | 'completed' | 'failed';

    // Timestamps
    uploadedAt: string;
    updatedAt: string;

    // TTL for automatic cleanup (optional)
    ttl?: number;

    // GSI1 for tenant queries
    GSI1PK?: string; // Format: TENANT#<tenantId>
    GSI1SK?: string; // Format: FILE#<uploadedAt>
}

/**
 * Tracks the processing lifecycle and analysis results for a document.
 * 
 * This model supports both document-level status (SK=STATUS) and page-level analysis (SK=PAGE#).
 * DynamoDB Streams are utilized to trigger the Aggregator Lambda once all chunks are processed.
 */
export interface DocumentStatus {
    // Primary Key
    PK: string; // Format: DOC#<fileId>
    SK: string; // Format: PAGE#<pageNumber> or STATUS

    // Document Information
    fileId: string;
    tenantId: string;

    // Page-specific attributes (when SK = PAGE#<pageNumber>)
    pageNumber?: number;
    pageAnalysis?: string; // JSON string of Gemini analysis
    chunkIds?: string[];

    // Document-level status (when SK = STATUS)
    // These fields trigger DynamoDB Streams when updated
    overallStatus?: 'pending' | 'chunking' | 'processing' | 'aggregating' | 'completed' | 'failed';
    totalPages?: number;
    processedPages?: number; // CRITICAL: Incremented by workers, triggers Lambda when == totalPages
    failedPages?: number;

    // Processing metadata
    startedAt?: string;
    completedAt?: string;
    errorMessage?: string;

    // Results
    resultS3Key?: string;

    // Timestamps
    createdAt: string;
    updatedAt: string;

    // TTL for automatic cleanup
    ttl?: number;

    // GSI1 for status queries
    GSI1PK?: string; // Format: TENANT#<tenantId>#STATUS
    GSI1SK?: string; // Format: <updatedAt>
}

/**
 * DynamoDB Stream Event for Aggregator Lambda
 * This is what the Lambda receives when processedPages is updated
 */
export interface DocumentStatusStreamEvent {
    eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
    dynamodb: {
        NewImage?: DocumentStatus;
        OldImage?: DocumentStatus;
        Keys: {
            PK: string;
            SK: string;
        };
    };
}

/**
 * Utility class for generating consistent DynamoDB partition and sort keys.
 * Implements the single-table design pattern for the PDF Processor.
 */
export class DynamoDBKeyGenerator {
    // File Metadata Keys
    static fileMetadataKeys(fileId: string): { PK: string; SK: string } {
        return {
            PK: `FILE#${fileId}`,
            SK: 'METADATA',
        };
    }

    static fileMetadataGSI1Keys(tenantId: string, uploadedAt: string): { GSI1PK: string; GSI1SK: string } {
        return {
            GSI1PK: `TENANT#${tenantId}`,
            GSI1SK: `FILE#${uploadedAt}`,
        };
    }

    // Document Status Keys
    static documentStatusKeys(fileId: string): { PK: string; SK: string } {
        return {
            PK: `DOC#${fileId}`,
            SK: 'STATUS',
        };
    }

    static documentPageKeys(fileId: string, pageNumber: number): { PK: string; SK: string } {
        return {
            PK: `DOC#${fileId}`,
            SK: `PAGE#${pageNumber.toString().padStart(4, '0')}`,
        };
    }

    static documentStatusGSI1Keys(tenantId: string, updatedAt: string): { GSI1PK: string; GSI1SK: string } {
        return {
            GSI1PK: `TENANT#${tenantId}#STATUS`,
            GSI1SK: updatedAt,
        };
    }

    // Generate TTL (30 days from now)
    static generateTTL(days = 30): number {
        return Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
    }

    /**
     * Check if document processing is complete
     * Used by DynamoDB Streams filter to trigger Aggregator Lambda
     */
    static isProcessingComplete(status: DocumentStatus): boolean {
        return (
            status.SK === 'STATUS' &&
            status.processedPages !== undefined &&
            status.totalPages !== undefined &&
            status.processedPages === status.totalPages &&
            status.overallStatus === 'processing'
        );
    }
}
