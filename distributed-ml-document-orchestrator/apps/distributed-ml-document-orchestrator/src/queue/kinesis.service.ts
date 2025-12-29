import { Injectable, Inject, Logger } from '@nestjs/common';
import { KinesisClient } from '@aws-sdk/client-kinesis';
import {
    PutRecordCommand,
    PutRecordsCommand,
    DescribeStreamCommand,
    GetShardIteratorCommand,
    GetRecordsCommand,
} from '@aws-sdk/client-kinesis';

export interface KinesisEvent<T = unknown> {
    eventType: string;
    data: T;
    timestamp: string;
    metadata?: Record<string, unknown>;
}

export interface PublishOptions {
    streamName?: string;
    partitionKey: string;
    data: unknown;
    eventType: string;
}

export interface BatchPublishOptions {
    streamName?: string;
    records: Array<{
        partitionKey: string;
        data: unknown;
        eventType: string;
    }>;
}

@Injectable()
export class KinesisService {
    private readonly logger = new Logger(KinesisService.name);
    private readonly streamName: string;

    constructor(
        @Inject('KINESIS_CLIENT')
        private readonly kinesisClient: KinesisClient,
    ) {
        this.streamName = process.env.KINESIS_STREAM_NAME || 'document-processing-stream';
    }

    /**
     * Dispatches a single event to the Kinesis stream.
     * Wraps the data in a standard event envelope with metadata and timestamps.
     */
    async publishEvent<T = unknown>(options: PublishOptions): Promise<{ sequenceNumber: string; shardId: string }> {
        const { streamName = this.streamName, partitionKey, data, eventType } = options;

        const event: KinesisEvent<T> = {
            eventType,
            data: data as T,
            timestamp: new Date().toISOString(),
            metadata: {
                source: 'document-orchestrator',
            },
        };

        try {
            const response = await this.kinesisClient.send(
                new PutRecordCommand({
                    StreamName: streamName,
                    PartitionKey: partitionKey,
                    Data: Buffer.from(JSON.stringify(event)),
                }),
            );

            this.logger.log(`Event published to Kinesis: ${eventType} (Shard: ${response.ShardId})`);

            return {
                sequenceNumber: response.SequenceNumber || '',
                shardId: response.ShardId || '',
            };
        } catch (error) {
            this.logger.error(`Failed to publish event to Kinesis: ${error.message}`, error.stack);
            throw new Error(`Kinesis publish failed: ${error.message}`);
        }
    }

    /**
     * Dispatches multiple events to Kinesis in a single batch request.
     * Supports up to 500 records per call, as per AWS Kinesis limits.
     */
    async publishBatch(options: BatchPublishOptions): Promise<{
        successCount: number;
        failedCount: number;
        failedRecords: unknown[];
    }> {
        const { streamName = this.streamName, records } = options;

        if (records.length === 0) {
            return { successCount: 0, failedCount: 0, failedRecords: [] };
        }

        if (records.length > 500) {
            throw new Error('Batch size cannot exceed 500 records');
        }

        const kinesisRecords = records.map((record) => {
            const event: KinesisEvent = {
                eventType: record.eventType,
                data: record.data,
                timestamp: new Date().toISOString(),
                metadata: {
                    source: 'document-orchestrator',
                },
            };

            return {
                PartitionKey: record.partitionKey,
                Data: Buffer.from(JSON.stringify(event)),
            };
        });

        try {
            const response = await this.kinesisClient.send(
                new PutRecordsCommand({
                    StreamName: streamName,
                    Records: kinesisRecords,
                }),
            );

            const failedCount = response.FailedRecordCount || 0;
            const successCount = records.length - failedCount;

            const failedRecords = response.Records
                ?.map((result, index) => (result.ErrorCode ? records[index] : null))
                .filter((record): record is BatchPublishOptions['records'][0] => record !== null) || [];

            this.logger.log(`Batch published to Kinesis: ${successCount} succeeded, ${failedCount} failed`);

            if (failedCount > 0) {
                this.logger.warn(`Failed records:`, failedRecords);
            }

            return {
                successCount,
                failedCount,
                failedRecords,
            };
        } catch (error) {
            this.logger.error(`Failed to publish batch to Kinesis: ${error.message}`, error.stack);
            throw new Error(`Kinesis batch publish failed: ${error.message}`);
        }
    }

    /**
     * Convenience method to publish an event specifically for new document uploads.
     */
    async publishDocumentUploadEvent(fileId: string, tenantId: string, metadata: unknown): Promise<void> {
        await this.publishEvent({
            partitionKey: tenantId,
            eventType: 'document.uploaded',
            data: {
                fileId,
                tenantId,
                ...(metadata as Record<string, unknown>),
            },
        });
    }

    /**
     * Dispatches an event indicating that a specific document chunk is ready for analysis.
     */
    async publishChunkEvent(
        fileId: string,
        tenantId: string,
        pageNumber: number,
        chunkData: unknown,
    ): Promise<void> {
        await this.publishEvent({
            partitionKey: `${tenantId}#${fileId}`,
            eventType: 'chunk.ready',
            data: {
                fileId,
                tenantId,
                pageNumber,
                ...(chunkData as Record<string, unknown>),
            },
        });
    }

    /**
     * Efficiently dispatches a batch of chunk processing events, automatically
     * handling pagination into 500-record segments.
     */
    async publishChunkBatch(
        fileId: string,
        tenantId: string,
        chunks: Array<{ pageNumber: number; data: unknown }>,
    ): Promise<void> {
        const records = chunks.map((chunk) => ({
            partitionKey: `${tenantId}#${fileId}`,
            eventType: 'chunk.ready',
            data: {
                fileId,
                tenantId,
                pageNumber: chunk.pageNumber,
                ...(chunk.data as Record<string, unknown>),
            },
        }));

        // Split into batches of 500
        const batchSize = 500;
        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, i + batchSize);
            await this.publishBatch({ records: batch });
        }
    }

    /**
     * Get stream description
     */
    async describeStream(streamName?: string): Promise<unknown> {
        try {
            const response = await this.kinesisClient.send(
                new DescribeStreamCommand({
                    StreamName: streamName || this.streamName,
                }),
            );

            return response.StreamDescription;
        } catch (error) {
            this.logger.error(`Failed to describe stream: ${error.message}`, error.stack);
            throw new Error(`Failed to describe stream: ${error.message}`);
        }
    }

    /**
     * Check if stream is active
     */
    async isStreamActive(streamName?: string): Promise<boolean> {
        try {
            const description = await this.describeStream(streamName) as { StreamStatus: string };
            return description.StreamStatus === 'ACTIVE';
        } catch (error) {
            this.logger.error(`Failed to check stream status: ${error.message}`);
            return false;
        }
    }

    async getShardIterator(streamName: string, shardId: string, iteratorType: 'TRIM_HORIZON' | 'LATEST' = 'LATEST'): Promise<string | undefined> {
        try {
            const command = new GetShardIteratorCommand({
                StreamName: streamName,
                ShardId: shardId,
                ShardIteratorType: iteratorType,
            });
            const response = await this.kinesisClient.send(command);
            return response.ShardIterator;
        } catch (error) {
            this.logger.error(`Failed to get shard iterator: ${error.message}`, error.stack);
            throw error;
        }
    }

    async getRecords(shardIterator: string, limit: number = 10) {
        try {
            const command = new GetRecordsCommand({
                ShardIterator: shardIterator,
                Limit: limit,
            });
            const response = await this.kinesisClient.send(command);
            return {
                records: response.Records,
                nextShardIterator: response.NextShardIterator,
                millisBehindLatest: response.MillisBehindLatest,
            };
        } catch (error) {
            this.logger.error(`Failed to get records: ${error.message}`, error.stack);
            throw error;
        }
    }
}
