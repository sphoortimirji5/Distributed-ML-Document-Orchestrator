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
            // Transition the document status to indicate aggregation is in progress
            await this.documentStatusService.updateStatus(fileId, tenantId, 'aggregating');

            // Collect all individual chunk analysis results from the database
            const pages = await this.documentStatusService.getDocumentPages(fileId);

            // Guard Clause: Ensure all pages are present before building final JSON
            if (pages.length < totalPages) {
                this.logger.warn(`Aggregation deferred for ${fileId}: Only ${pages.length}/${totalPages} pages available.`);
                // Reset status to processing so it can be re-triggered
                await this.documentStatusService.updateStatus(fileId, tenantId, 'processing');
                return;
            }

            const aggregatedResults = {
                fileId,
                tenantId,
                processedAt: new Date().toISOString(),
                totalPages,
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

            this.logger.log(`Successfully aggregated results for document: ${fileId}`);
        } catch (error) {
            this.logger.error(`Failed to aggregate results for ${fileId}: ${error.message}`, error.stack);
            await this.documentStatusService.updateDocumentStatus(fileId, {
                overallStatus: 'failed',
                errorMessage: `Aggregation failed: ${error.message}`
            });
            throw error;
        }
    }
}
