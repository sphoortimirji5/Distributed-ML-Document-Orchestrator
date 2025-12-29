import { Injectable, Inject } from '@nestjs/common';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PutCommand, GetCommand, UpdateCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { FileMetadata, DynamoDBKeyGenerator } from './models';

@Injectable()
export class FileMetadataService {
    private readonly tableName: string;

    constructor(
        @Inject('DYNAMODB_CLIENT')
        private readonly dynamoClient: DynamoDBDocumentClient,
    ) {
        this.tableName = process.env.DYNAMODB_TABLE_NAME || 'DocumentOrchestrator';
    }

    /**
     * Persists or updates the metadata for an uploaded file.
     * Includes details such as file name, size, and S3 location.
     */
    async saveFileMetadata(metadata: Omit<FileMetadata, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'>): Promise<FileMetadata> {
        const keys = DynamoDBKeyGenerator.fileMetadataKeys(metadata.fileId);
        const gsiKeys = DynamoDBKeyGenerator.fileMetadataGSI1Keys(metadata.tenantId, metadata.uploadedAt);

        const item: FileMetadata = {
            ...keys,
            ...gsiKeys,
            ...metadata,
            ttl: DynamoDBKeyGenerator.generateTTL(90), // 90 days retention
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
     * Retrieves the metadata for a specific file using its unique identifier.
     */
    async getFileMetadata(fileId: string): Promise<FileMetadata | null> {
        const keys = DynamoDBKeyGenerator.fileMetadataKeys(fileId);

        const result = await this.dynamoClient.send(
            new GetCommand({
                TableName: this.tableName,
                Key: keys,
            }),
        );

        return (result.Item as FileMetadata) || null;
    }

    /**
     * Updates the processing status of a file and records any error messages if applicable.
     */
    async updateFileStatus(
        fileId: string,
        status: FileMetadata['status'],
        errorMessage?: string,
    ): Promise<void> {
        const keys = DynamoDBKeyGenerator.fileMetadataKeys(fileId);

        await this.dynamoClient.send(
            new UpdateCommand({
                TableName: this.tableName,
                Key: keys,
                UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt' + (errorMessage ? ', errorMessage = :error' : ''),
                ExpressionAttributeNames: {
                    '#status': 'status',
                },
                ExpressionAttributeValues: {
                    ':status': status,
                    ':updatedAt': new Date().toISOString(),
                    ...(errorMessage && { ':error': errorMessage }),
                },
            }),
        );
    }

    /**
     * Retrieves a list of all files associated with a specific tenant.
     * Results are ordered by upload date, with the most recent files first.
     */
    async getFilesByTenant(tenantId: string, limit = 50): Promise<FileMetadata[]> {
        const result = await this.dynamoClient.send(
            new QueryCommand({
                TableName: this.tableName,
                IndexName: 'GSI1',
                KeyConditionExpression: 'GSI1PK = :gsi1pk',
                ExpressionAttributeValues: {
                    ':gsi1pk': `TENANT#${tenantId}`,
                },
                Limit: limit,
                ScanIndexForward: false, // Most recent first
            }),
        );

        return (result.Items as FileMetadata[]) || [];
    }

    /**
     * Delete file metadata
     */
    async deleteFileMetadata(fileId: string): Promise<void> {
        const keys = DynamoDBKeyGenerator.fileMetadataKeys(fileId);

        await this.dynamoClient.send(
            new DeleteCommand({
                TableName: this.tableName,
                Key: keys,
            }),
        );
    }
}
