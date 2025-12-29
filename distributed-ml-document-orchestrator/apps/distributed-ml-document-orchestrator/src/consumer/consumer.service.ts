import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KinesisService } from '../queue/kinesis.service';
import { S3Service } from '../storage/s3.service';
import { FileMetadataService } from '../database/file-metadata.service';
import { DocumentStatusService } from '../database/document-status.service';
import { GeminiService } from '../ml/gemini.service';
const pdf = require('pdf-parse/lib/pdf-parse.js');

@Injectable()
export class ConsumerService implements OnModuleInit {
    private readonly logger = new Logger(ConsumerService.name);
    private isPolling = false;
    private readonly streamName = process.env.KINESIS_STREAM_NAME || 'document-events';

    constructor(
        private readonly kinesisService: KinesisService,
        private readonly s3Service: S3Service,
        private readonly fileMetadataService: FileMetadataService,
        private readonly documentStatusService: DocumentStatusService,
        private readonly geminiService: GeminiService,
    ) { }

    onModuleInit() {
        this.startPolling();
    }

    private async startPolling() {
        if (this.isPolling) return;
        this.isPolling = true;
        this.logger.log('Starting Kinesis consumer polling...');
        this.pollLoop();
    }

    private async pollLoop() {
        // Basic polling implementation
        // In production, use KCL or Lambda triggers
        let shardIterator: string | undefined;

        while (this.isPolling) {
            try {
                if (!shardIterator) {
                    this.logger.log('Acquiring new Kinesis shard iterator...');
                    // Assuming single shard for MVP: shardId-000000000000
                    shardIterator = await this.kinesisService.getShardIterator(
                        this.streamName,
                        'shardId-000000000000',
                        'LATEST'
                    );
                }

                const response = await this.kinesisService.getRecords(shardIterator, 10);
                shardIterator = response.nextShardIterator;

                if (response.records && response.records.length > 0) {
                    this.logger.log(`Received ${response.records.length} records`);

                    for (const record of response.records) {
                        try {
                            const data = JSON.parse(Buffer.from(record.Data).toString());
                            if (data.eventType === 'document.uploaded') {
                                const { fileId, tenantId, s3Key, bucket } = data.data;
                                // Use bucket from event or default
                                const targetBucket = bucket || process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs';
                                await this.processDocument(fileId, tenantId, s3Key, targetBucket);
                            }
                        } catch (e) {
                            this.logger.error('Error parsing record', e);
                        }
                    }
                }

                // Wait before next poll to avoid throttling
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                this.logger.error('Error in polling loop', error);

                // If iterator expired, reset it so we re-acquire on next loop
                if (error.name === 'ExpiredIteratorException' || error.__type === 'ExpiredIteratorException') {
                    this.logger.warn('Shard iterator expired, will re-acquire...');
                    shardIterator = undefined;
                }

                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async processDocument(fileId: string, tenantId: string, s3Key: string, bucket: string) {
        this.logger.log(`Processing document: ${fileId}`);

        try {
            // Mark the document as being in the processing state
            await this.documentStatusService.updateStatus(fileId, tenantId, 'processing');

            // Retrieve the raw file content from S3 storage
            const fileBuffer = await this.s3Service.downloadFile(bucket, s3Key);

            // Extract text content page-by-page from the PDF buffer
            const pageTexts: string[] = [];
            const options = {
                pagerender: async (pageData: any) => {
                    const textContent = await pageData.getTextContent();
                    const pageText = textContent.items
                        .map((item: any) => item.str)
                        .join(' ');
                    pageTexts.push(pageText);
                    return pageText;
                }
            };

            const data = await pdf(fileBuffer, options);
            const numPages = data.numpages;

            this.logger.log(`Parsed PDF: ${numPages} pages`);

            // Record the total page count for status tracking and aggregation logic
            await this.documentStatusService.updateTotalPages(fileId, tenantId, numPages);

            // Each page is treated as a single chunk for ML analysis
            const chunks = pageTexts;
            this.logger.log(`Created ${chunks.length} chunks (one per page)`);

            // Iterate through each page and perform analysis using the Gemini API
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                this.logger.log(`Processing page ${i + 1}/${chunks.length}`);

                try {
                    const analysis = await this.geminiService.analyzeChunk(chunk);

                    // Persist the analysis result for this specific page
                    await this.documentStatusService.savePageAttributes(
                        fileId,
                        tenantId,
                        i + 1,
                        JSON.stringify(analysis)
                    );
                } catch (chunkError) {
                    this.logger.error(`Failed to process page ${i + 1}`, chunkError);
                    // Save a failure placeholder so the aggregator can still proceed
                    await this.documentStatusService.savePageAttributes(
                        fileId,
                        tenantId,
                        i + 1,
                        JSON.stringify({ error: 'Analysis failed', timestamp: new Date().toISOString() })
                    );
                } finally {
                    // Track progress by incrementing the count of attempted pages
                    // This ensures the aggregator triggers even if some pages fail
                    await this.documentStatusService.incrementProcessedPages(fileId);
                }

                // Add a small delay between pages to manage API rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // The final aggregation is handled asynchronously by the Aggregator Lambda,
            // which is triggered via DynamoDB Streams once all pages are processed.
            this.logger.log(`Page processing complete for document: ${fileId}. Awaiting aggregation...`);

        } catch (error) {
            this.logger.error(`Failed to process document ${fileId}`, error);
            await this.documentStatusService.updateStatus(fileId, tenantId, 'failed');
        }
    }
}
