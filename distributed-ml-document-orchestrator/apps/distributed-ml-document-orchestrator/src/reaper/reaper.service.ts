import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DocumentStatusService } from '../database/document-status.service';

/**
 * Document Reaper Service
 * 
 * Detects and handles stuck documents that have been in 'processing' state
 * for too long without making progress. This handles cases where:
 * - Consumer crashed mid-processing
 * - Pages went to DLQ after exhausting retries
 * - Network failures prevented completion
 * 
 * Configuration via environment variables:
 * - REAPER_STUCK_THRESHOLD_MINS: Minutes before document is considered stuck (default: 30)
 */
@Injectable()
export class ReaperService {
    private readonly logger = new Logger(ReaperService.name);

    // Documents stuck longer than this are considered failed
    private readonly STUCK_THRESHOLD_MS: number;

    constructor(
        private readonly documentStatusService: DocumentStatusService,
    ) {
        const thresholdMins = parseInt(process.env.REAPER_STUCK_THRESHOLD_MINS || '30', 10);
        this.STUCK_THRESHOLD_MS = thresholdMins * 60 * 1000;
        this.logger.log(`Reaper configured with stuck threshold: ${thresholdMins} minutes`);
    }

    /**
     * Scheduled job that runs every 5 minutes to find and handle stuck documents.
     * Cron expression can be overridden via REAPER_CRON_EXPRESSION env var.
     */
    @Cron(process.env.REAPER_CRON_EXPRESSION || '0 */5 * * * *')
    async reapStuckDocuments(): Promise<void> {
        this.logger.log('Reaper: Scanning for stuck documents...');

        try {
            const stuckDocuments = await this.documentStatusService.getStuckDocuments(
                this.STUCK_THRESHOLD_MS
            );

            if (stuckDocuments.length === 0) {
                this.logger.log('Reaper: No stuck documents found');
                return;
            }

            this.logger.warn(`Reaper: Found ${stuckDocuments.length} stuck documents`);

            for (const doc of stuckDocuments) {
                await this.handleStuckDocument(doc);
            }

            this.logger.log(`Reaper: Processed ${stuckDocuments.length} stuck documents`);
        } catch (error) {
            this.logger.error('Reaper: Failed to scan for stuck documents', error);
        }
    }

    /**
     * Handle a single stuck document by marking it as failed.
     */
    private async handleStuckDocument(doc: {
        fileId: string;
        tenantId: string;
        processedPages: number;
        totalPages: number;
        updatedAt: string;
    }): Promise<void> {
        const stuckDuration = Date.now() - new Date(doc.updatedAt).getTime();
        const stuckMinutes = Math.round(stuckDuration / 60000);

        this.logger.warn(
            `Reaper: Marking document ${doc.fileId} as failed ` +
            `(stuck for ${stuckMinutes} mins, ${doc.processedPages}/${doc.totalPages} pages)`
        );

        try {
            await this.documentStatusService.updateStatus(
                doc.fileId,
                doc.tenantId,
                'failed',
                `Reaper: Document stuck in processing for ${stuckMinutes} minutes`
            );
        } catch (error) {
            this.logger.error(`Reaper: Failed to mark ${doc.fileId} as failed`, error);
        }
    }

    /**
     * Manual trigger for testing or operator intervention.
     */
    async triggerManualReap(): Promise<{ processed: number; failed: string[] }> {
        this.logger.log('Reaper: Manual trigger initiated');

        const stuckDocuments = await this.documentStatusService.getStuckDocuments(
            this.STUCK_THRESHOLD_MS
        );

        const failed: string[] = [];
        for (const doc of stuckDocuments) {
            try {
                await this.handleStuckDocument(doc);
            } catch {
                failed.push(doc.fileId);
            }
        }

        return { processed: stuckDocuments.length, failed };
    }
}
