import { Test, TestingModule } from '@nestjs/testing';
import { KinesisModule } from './kinesis.module';
import { KinesisService } from './kinesis.service';

describe('KinesisService - Local Tests', () => {
    let service: KinesisService;

    beforeAll(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [KinesisModule],
            providers: [KinesisService],
        }).compile();

        service = module.get<KinesisService>(KinesisService);
    });

    describe('Stream Operations', () => {
        it('should check if stream is active', async () => {
            const isActive = await service.isStreamActive();
            expect(typeof isActive).toBe('boolean');
        });

        it('should describe stream', async () => {
            const description = await service.describeStream() as any;
            expect(description).toBeDefined();
            expect(description.StreamName).toBe(process.env.KINESIS_STREAM_NAME || 'document-processing-stream');
        });
    });

    describe('Event Publishing', () => {
        const testFileId = `test-file-${Date.now()}`;
        const testTenantId = 'test-tenant';

        it('should publish a single event', async () => {
            const result = await service.publishEvent({
                partitionKey: testTenantId,
                eventType: 'test.event',
                data: {
                    fileId: testFileId,
                    message: 'Test event',
                },
            });

            expect(result).toBeDefined();
            expect(result.sequenceNumber).toBeDefined();
            expect(result.shardId).toBeDefined();
        });

        it('should publish document upload event', async () => {
            await service.publishDocumentUploadEvent(testFileId, testTenantId, {
                fileName: 'test.pdf',
                fileSize: 1024,
            });

            // No error means success
            expect(true).toBe(true);
        });

        it('should publish chunk event', async () => {
            await service.publishChunkEvent(testFileId, testTenantId, 1, {
                content: 'Page 1 content',
                chunkId: 'chunk-1',
            });

            expect(true).toBe(true);
        });

        it('should publish batch of events', async () => {
            const records = [
                {
                    partitionKey: testTenantId,
                    eventType: 'chunk.ready',
                    data: { fileId: testFileId, pageNumber: 1 },
                },
                {
                    partitionKey: testTenantId,
                    eventType: 'chunk.ready',
                    data: { fileId: testFileId, pageNumber: 2 },
                },
                {
                    partitionKey: testTenantId,
                    eventType: 'chunk.ready',
                    data: { fileId: testFileId, pageNumber: 3 },
                },
            ];

            const result = await service.publishBatch({ records });

            expect(result).toBeDefined();
            expect(result.successCount).toBe(3);
            expect(result.failedCount).toBe(0);
        });

        it('should publish chunk batch', async () => {
            const chunks = [
                { pageNumber: 1, data: { content: 'Page 1' } },
                { pageNumber: 2, data: { content: 'Page 2' } },
                { pageNumber: 3, data: { content: 'Page 3' } },
            ];

            await service.publishChunkBatch(testFileId, testTenantId, chunks);

            expect(true).toBe(true);
        });

        it('should handle batch size limit', async () => {
            const largeRecords = Array.from({ length: 600 }, (_, i) => ({
                partitionKey: testTenantId,
                eventType: 'test.event',
                data: { index: i },
            }));

            await expect(service.publishBatch({ records: largeRecords })).rejects.toThrow(
                'Batch size cannot exceed 500 records',
            );
        });
    });
});
