import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { DocumentStatusService } from '../database/document-status.service';
import { FileMetadataService } from '../database/file-metadata.service';
import { S3Service } from '../storage/s3.service';

@Controller('jobs')
export class JobsController {
    constructor(
        private readonly documentStatusService: DocumentStatusService,
        private readonly fileMetadataService: FileMetadataService,
        private readonly s3Service: S3Service,
    ) { }

    @Get(':fileId')
    async getJobStatus(@Param('fileId') fileId: string) {
        const status = await this.documentStatusService.getDocumentStatus(fileId);
        if (!status) {
            throw new NotFoundException(`Job not found for file ID: ${fileId}`);
        }

        const metadata = await this.fileMetadataService.getFileMetadata(fileId);

        const response: any = {
            fileId,
            fileName: metadata?.fileName,
            status: status.overallStatus,
            progress: {
                processed: status.processedPages,
                total: status.totalPages,
                failed: status.failedPages,
            },
            timestamps: {
                uploaded: metadata?.uploadedAt,
                started: status.startedAt,
                completed: status.completedAt,
            },
            result: status.resultS3Key ? { s3Key: status.resultS3Key } : null,
        };

        // For completed jobs, generate a time-limited pre-signed URL for direct result download
        if (status.overallStatus === 'completed' && status.resultS3Key) {
            response.downloadUrl = await this.s3Service.getPresignedUrl({
                bucket: process.env.S3_RESULTS_BUCKET || 'document-orchestrator-results',
                key: status.resultS3Key,
                expiresIn: 3600
            });
        }

        return response;
    }

    @Get(':fileId/results')
    async getJobResults(@Param('fileId') fileId: string) {
        const status = await this.documentStatusService.getDocumentStatus(fileId);
        if (!status || !status.resultS3Key) {
            throw new NotFoundException(`Results not found for file ID: ${fileId}`);
        }

        const bucket = process.env.S3_RESULTS_BUCKET || 'document-orchestrator-results';
        const results = await this.s3Service.downloadFile(bucket, status.resultS3Key);
        return JSON.parse(results.toString());
    }

    @Get(':fileId/download')
    async getJobDownloadUrl(@Param('fileId') fileId: string) {
        const status = await this.documentStatusService.getDocumentStatus(fileId);
        if (!status || !status.resultS3Key) {
            throw new NotFoundException(`Results not found for file ID: ${fileId}`);
        }

        const bucket = process.env.S3_RESULTS_BUCKET || 'document-orchestrator-results';
        const url = await this.s3Service.getPresignedUrl({
            bucket,
            key: status.resultS3Key,
            expiresIn: 3600, // 1 hour
        });

        return {
            fileId,
            downloadUrl: url,
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        };
    }

    @Get('tenant/:tenantId')
    async getTenantJobs(@Param('tenantId') tenantId: string) {
        const jobs = await this.fileMetadataService.getFilesByTenant(tenantId);
        return jobs.map((job) => ({
            fileId: job.fileId,
            fileName: job.fileName,
            status: job.status,
            uploadedAt: job.uploadedAt,
        }));
    }
}
