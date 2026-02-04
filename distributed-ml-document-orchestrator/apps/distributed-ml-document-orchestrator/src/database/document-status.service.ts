import { Injectable, Inject } from '@nestjs/common';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PutCommand, GetCommand, UpdateCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DocumentStatus, DynamoDBKeyGenerator } from './models';

@Injectable()
export class DocumentStatusService {
    private readonly tableName: string;

    constructor(
        @Inject('DYNAMODB_CLIENT')
        private readonly dynamoClient: DynamoDBDocumentClient,
    ) {
        const tableName = process.env.DYNAMODB_TABLE_NAME;
        if (!tableName) {
            throw new Error('DYNAMODB_TABLE_NAME environment variable is required');
        }
        this.tableName = tableName;
    }

    /**
     * Initializes a new document status record in DynamoDB.
     * Sets the initial state to 'pending' and configures the TTL for automatic cleanup.
     */
    async createDocumentStatus(
        fileId: string,
        tenantId: string,
        totalPages: number,
    ): Promise<DocumentStatus> {
        const keys = DynamoDBKeyGenerator.documentStatusKeys(fileId);
        const gsiKeys = DynamoDBKeyGenerator.documentStatusGSI1Keys(tenantId, new Date().toISOString());

        const item: DocumentStatus = {
            ...keys,
            ...gsiKeys,
            fileId,
            tenantId,
            overallStatus: 'pending',
            totalPages,
            processedPages: 0,
            failedPages: 0,
            startedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ttl: DynamoDBKeyGenerator.generateTTL(90),
        };

        await this.dynamoClient.send(
            new PutCommand({
                TableName: this.tableName,
                Item: item,
            }),
        );

        return item;
    }

    /**
     * Retrieves the current status and progress of a document processing job.
     */
    async getDocumentStatus(fileId: string): Promise<DocumentStatus | null> {
        const keys = DynamoDBKeyGenerator.documentStatusKeys(fileId);

        const result = await this.dynamoClient.send(
            new GetCommand({
                TableName: this.tableName,
                Key: keys,
            }),
        );

        return (result.Item as DocumentStatus) || null;
    }

    /**
     * Updates specific attributes of a document's status record.
     * Automatically manages the 'updatedAt' timestamp for all modifications.
     */
    async updateDocumentStatus(
        fileId: string,
        updates: Partial<Pick<DocumentStatus, 'overallStatus' | 'processedPages' | 'failedPages' | 'completedAt' | 'errorMessage' | 'resultS3Key'>>,
    ): Promise<void> {
        const keys = DynamoDBKeyGenerator.documentStatusKeys(fileId);

        const updateExpressions: string[] = ['updatedAt = :updatedAt'];
        const expressionAttributeValues: Record<string, any> = {
            ':updatedAt': new Date().toISOString(),
        };

        Object.entries(updates).forEach(([key, value]) => {
            if (value !== undefined) {
                updateExpressions.push(`${key} = :${key}`);
                expressionAttributeValues[`:${key}`] = value;
            }
        });

        await this.dynamoClient.send(
            new UpdateCommand({
                TableName: this.tableName,
                Key: keys,
                UpdateExpression: `SET ${updateExpressions.join(', ')}`,
                ExpressionAttributeValues: expressionAttributeValues,
            }),
        );
    }

    /**
     * Persists analysis results or metadata for a specific document chunk.
     * Each chunk is stored as a separate record in the single-table design.
     * @param processingVersion - Immutable version stamp set when page is processed (not aggregation version)
     */
    async savePageAttributes(
        fileId: string,
        tenantId: string,
        pageNumber: number,
        pageAnalysis?: string,
        chunkIds?: string[],
        processingVersion?: number,
    ): Promise<DocumentStatus> {
        const keys = DynamoDBKeyGenerator.documentPageKeys(fileId, pageNumber);

        const item: DocumentStatus = {
            ...keys,
            fileId,
            tenantId,
            pageNumber,
            pageAnalysis,
            chunkIds,
            processingVersion,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ttl: DynamoDBKeyGenerator.generateTTL(90),
        };

        await this.dynamoClient.send(
            new PutCommand({
                TableName: this.tableName,
                Item: item,
            }),
        );

        return item;
    }

    /**
     * Retrieves all processed chunk records associated with a specific document.
     */
    async getDocumentPages(fileId: string): Promise<DocumentStatus[]> {
        const result = await this.dynamoClient.send(
            new QueryCommand({
                TableName: this.tableName,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
                ExpressionAttributeValues: {
                    ':pk': `DOC#${fileId}`,
                    ':sk': 'PAGE#',
                },
            }),
        );

        return (result.Items as DocumentStatus[]) || [];
    }

    /**
     * Get specific page
     */
    async getPage(fileId: string, pageNumber: number): Promise<DocumentStatus | null> {
        const keys = DynamoDBKeyGenerator.documentPageKeys(fileId, pageNumber);

        const result = await this.dynamoClient.send(
            new GetCommand({
                TableName: this.tableName,
                Key: keys,
            }),
        );

        return (result.Item as DocumentStatus) || null;
    }

    /**
     * Atomically increments the count of processed chunks for a document.
     * This operation is used to trigger completion logic when the count reaches the total.
     */
    async incrementProcessedPages(fileId: string): Promise<void> {
        const keys = DynamoDBKeyGenerator.documentStatusKeys(fileId);

        await this.dynamoClient.send(
            new UpdateCommand({
                TableName: this.tableName,
                Key: keys,
                UpdateExpression: 'SET processedPages = if_not_exists(processedPages, :zero) + :inc, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':zero': 0,
                    ':inc': 1,
                    ':updatedAt': new Date().toISOString(),
                },
            }),
        );
    }

    /**
     * Retrieves a list of documents for a specific tenant, filtered by status.
     * Uses the GSI1 index for efficient querying.
     */
    async getDocumentsByStatus(tenantId: string, limit = 50): Promise<DocumentStatus[]> {
        const result = await this.dynamoClient.send(
            new QueryCommand({
                TableName: this.tableName,
                IndexName: 'GSI1',
                KeyConditionExpression: 'GSI1PK = :gsi1pk',
                ExpressionAttributeValues: {
                    ':gsi1pk': `TENANT#${tenantId}#STATUS`,
                },
                Limit: limit,
                ScanIndexForward: false, // Most recent first
            }),
        );

        return (result.Items as DocumentStatus[]) || [];
    }
    /**
     * Update overall status with optional error message.
     */
    async updateStatus(fileId: string, tenantId: string, status: string, errorMessage?: string): Promise<void> {
        const updates: Partial<Pick<DocumentStatus, 'overallStatus' | 'errorMessage'>> = {
            overallStatus: status as DocumentStatus['overallStatus'],
        };
        if (errorMessage) {
            updates.errorMessage = errorMessage;
        }
        await this.updateDocumentStatus(fileId, updates);
    }

    /**
     * Update total pages
     */
    async updateTotalPages(fileId: string, tenantId: string, totalPages: number): Promise<void> {
        const keys = DynamoDBKeyGenerator.documentStatusKeys(fileId);
        await this.dynamoClient.send(
            new UpdateCommand({
                TableName: this.tableName,
                Key: keys,
                UpdateExpression: 'SET totalPages = :totalPages, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':totalPages': totalPages,
                    ':updatedAt': new Date().toISOString(),
                },
            }),
        );
    }
    /**
     * Find documents that are ready for aggregation
     * (processedPages === totalPages AND overallStatus === 'processing')
     */
    async getReadyForAggregation(): Promise<DocumentStatus[]> {
        const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
        const result = await this.dynamoClient.send(
            new ScanCommand({
                TableName: this.tableName,
                FilterExpression: 'SK = :sk AND overallStatus = :status AND processedPages = totalPages AND totalPages > :zero',
                ExpressionAttributeValues: {
                    ':sk': 'STATUS',
                    ':status': 'processing',
                    ':zero': 0,
                },
            }),
        );
        return (result.Items as DocumentStatus[]) || [];
    }

    /**
     * Atomically claims the aggregation lock for a document using optimistic locking.
     * This prevents race conditions when multiple DynamoDB Stream triggers fire simultaneously.
     * 
     * @returns { success: true, version: N } if lock acquired, { success: false, version: 0 } if already locked
     */
    async claimAggregationLock(fileId: string): Promise<{ success: boolean; version: number }> {
        const keys = DynamoDBKeyGenerator.documentStatusKeys(fileId);

        try {
            const result = await this.dynamoClient.send(
                new UpdateCommand({
                    TableName: this.tableName,
                    Key: keys,
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
                }),
            );
            return { success: true, version: (result.Attributes?.aggregationVersion as number) ?? 1 };
        } catch (error: unknown) {
            const err = error as { name?: string };
            if (err.name === 'ConditionalCheckFailedException') {
                return { success: false, version: 0 };
            }
            throw error;
        }
    }

    /**
     * Find documents stuck in 'processing' state for longer than the threshold.
     * Used by the Reaper service to detect and handle stuck documents.
     */
    async getStuckDocuments(thresholdMs: number): Promise<Array<{
        fileId: string;
        tenantId: string;
        processedPages: number;
        totalPages: number;
        updatedAt: string;
    }>> {
        const cutoffTime = new Date(Date.now() - thresholdMs).toISOString();

        // Scan for documents in 'processing' state
        // Note: In production, consider using a GSI on overallStatus for efficiency
        const result = await this.dynamoClient.send(
            new ScanCommand({
                TableName: this.tableName,
                FilterExpression: 'SK = :status AND overallStatus = :processing AND updatedAt < :cutoff',
                ExpressionAttributeValues: {
                    ':status': 'STATUS',
                    ':processing': 'processing',
                    ':cutoff': cutoffTime,
                },
            }),
        );

        return (result.Items || []).map((item) => ({
            fileId: item.fileId as string,
            tenantId: item.tenantId as string,
            processedPages: (item.processedPages as number) ?? 0,
            totalPages: (item.totalPages as number) ?? 0,
            updatedAt: item.updatedAt as string,
        }));
    }
}
