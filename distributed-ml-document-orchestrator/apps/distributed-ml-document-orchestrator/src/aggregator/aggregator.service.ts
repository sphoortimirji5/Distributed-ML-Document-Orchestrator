import { Injectable, Logger } from '@nestjs/common';
import { DocumentStatusService } from '../database/document-status.service';
import { S3Service } from '../storage/s3.service';

@Injectable()
export class AggregatorService {
    private readonly logger = new Logger(AggregatorService.name);

    constructor(
        private readonly documentStatusService: DocumentStatusService,
        private readonly s3Service: S3Service,
    ) { }

    async aggregateResults(fileId: string, tenantId: string, totalPages: number): Promise<void> {
        this.logger.log(`Aggregating results for document: ${fileId}`);

        try {
            // VERSIONED AGGREGATION: Atomically claim the lock to prevent double-fire
            const lock = await this.documentStatusService.claimAggregationLock(fileId);
            if (!lock.success) {
                this.logger.warn(`Aggregation already in progress for ${fileId}, skipping duplicate trigger`);
                return;
            }
            const currentVersion = lock.version;
            this.logger.log(`Acquired aggregation lock for ${fileId} (version ${currentVersion})`);

            // Collect all individual chunk analysis results from the database
            const allPages = await this.documentStatusService.getDocumentPages(fileId);

            // VERSIONED AGGREGATION: Filter pages by processingVersion matching current aggregationVersion
            const pages = allPages.filter(p => p.processingVersion === currentVersion);

            // Guard Clause: Ensure all pages are present before building final JSON
            if (pages.length < totalPages) {
                this.logger.warn(`Aggregation deferred for ${fileId}: Only ${pages.length}/${totalPages} pages match version ${currentVersion} (${allPages.length} total pages found)`);
                // Reset status to processing so it can be re-triggered
                await this.documentStatusService.updateStatus(fileId, tenantId, 'processing');
                return;
            }

            const aggregatedResults = {
                fileId,
                tenantId,
                processedAt: new Date().toISOString(),
                totalPages,
                aggregationVersion: currentVersion,
                successCount: pages.filter(p => p.pageAnalysis && !JSON.parse(p.pageAnalysis).error).length,
                failedCount: pages.filter(p => p.pageAnalysis && JSON.parse(p.pageAnalysis).error).length,
                chunks: pages.map(p => ({
                    pageNumber: p.pageNumber,
                    analysis: p.pageAnalysis ? JSON.parse(p.pageAnalysis) : null,
                    status: p.pageAnalysis && JSON.parse(p.pageAnalysis).error ? 'failed' : 'success'
                }))
            };

            // Compile the final results and upload the JSON manifest to S3
            const resultsKey = `${tenantId}/${fileId}/results.json`;
            await this.s3Service.uploadResults(fileId, tenantId, aggregatedResults);

            // Mark the entire processing job as completed and store the results location
            await this.documentStatusService.updateDocumentStatus(fileId, {
                overallStatus: 'completed',
                completedAt: new Date().toISOString(),
                resultS3Key: resultsKey
            });

            this.logger.log(`Successfully aggregated results for document: ${fileId} (version ${currentVersion})`);
        } catch (error: unknown) {
            const err = error as Error;
            this.logger.error(`Failed to aggregate results for ${fileId}: ${err.message}`, err.stack);
            await this.documentStatusService.updateDocumentStatus(fileId, {
                overallStatus: 'failed',
                errorMessage: `Aggregation failed: ${err.message}`
            });
            throw error;
        }
    }
}
