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
        const tableName = process.env.DYNAMODB_TABLE_NAME;
        if (!tableName) {
            throw new Error('DYNAMODB_TABLE_NAME environment variable is required');
        }
        this.tableName = tableName;
    }

    /**
     * Persists or updates the metadata for an uploaded file.
     * Includes details such as file name, size, and S3 location.
     */
    async saveFileMetadata(metadata: Omit<FileMetadata, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK' | 'GSI2PK' | 'GSI2SK'>): Promise<FileMetadata> {
        const keys = DynamoDBKeyGenerator.fileMetadataKeys(metadata.fileId);
        const gsiKeys = DynamoDBKeyGenerator.fileMetadataGSI1Keys(metadata.tenantId, metadata.uploadedAt);
        const gsi2Keys = metadata.contentHash
            ? DynamoDBKeyGenerator.fileMetadataGSI2Keys(metadata.tenantId, metadata.contentHash)
            : {};

        const item: FileMetadata = {
            ...keys,
            ...gsiKeys,
            ...gsi2Keys,
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
     * Finds a file by its content hash for deduplication.
     * Scoped to tenant to prevent cross-tenant hash collisions.
     */
    async findByContentHash(tenantId: string, contentHash: string): Promise<FileMetadata | null> {
        const gsi2Keys = DynamoDBKeyGenerator.fileMetadataGSI2Keys(tenantId, contentHash);

        const result = await this.dynamoClient.send(
            new QueryCommand({
                TableName: this.tableName,
                IndexName: 'GSI2',
                KeyConditionExpression: 'GSI2PK = :gsi2pk AND GSI2SK = :gsi2sk',
                ExpressionAttributeValues: {
                    ':gsi2pk': gsi2Keys.GSI2PK,
                    ':gsi2sk': gsi2Keys.GSI2SK,
                },
                Limit: 1,
            }),
        );

        if (result.Items && result.Items.length > 0) {
            // GSI2 has KEYS_ONLY projection, so fetch full item
            const keys = result.Items[0] as { PK: string; SK: string };
            return this.getFileMetadataByKeys(keys.PK, keys.SK);
        }

        return null;
    }

    /**
     * Retrieves file metadata using primary keys (internal helper).
     */
    private async getFileMetadataByKeys(pk: string, sk: string): Promise<FileMetadata | null> {
        const result = await this.dynamoClient.send(
            new GetCommand({
                TableName: this.tableName,
                Key: { PK: pk, SK: sk },
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
