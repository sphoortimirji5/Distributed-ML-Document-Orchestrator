import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AggregatorService } from './aggregator.service';
import { DocumentStatusService } from '../database/document-status.service';

@Injectable()
export class StreamPollerService implements OnModuleInit {
    private readonly logger = new Logger(StreamPollerService.name);
    private isPolling = false;

    constructor(
        private readonly aggregatorService: AggregatorService,
        private readonly documentStatusService: DocumentStatusService,
    ) { }

    onModuleInit() {
        // Only start polling in development mode to simulate DynamoDB Streams
        if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
            this.startPolling();
        }
    }

    private async startPolling() {
        if (this.isPolling) return;
        this.isPolling = true;
        this.logger.log('Starting local DynamoDB Stream poller simulation...');

        while (this.isPolling) {
            try {
                // In a real stream, we'd get events. Here we scan for "ready to aggregate" docs.
                // This is a simplified simulation for local development.
                await this.checkForCompletedDocuments();
            } catch (error) {
                this.logger.error('Error in stream poller', error);
            }
            // Poll every 5 seconds
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    private async checkForCompletedDocuments() {
        const completedDocs = await this.documentStatusService.getReadyForAggregation();

        if (completedDocs.length > 0) {
            this.logger.log(`Found ${completedDocs.length} documents ready for aggregation`);
            for (const doc of completedDocs) {
                try {
                    await this.aggregatorService.aggregateResults(doc.fileId, doc.tenantId, doc.totalPages);
                } catch (error) {
                    this.logger.error(`Failed to aggregate document ${doc.fileId}`, error);
                }
            }
        }
    }
}
