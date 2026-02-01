import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { S3Service } from '../storage/s3.service';
import { FileMetadataService } from '../database/file-metadata.service';
import { DocumentStatusService } from '../database/document-status.service';
import { KinesisService } from '../queue/kinesis.service';
import { ConsumerService } from '../consumer/consumer.service';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

export interface UploadResult {
    message: string;
    fileId: string;
    status: string;
    processingType?: 'sync' | 'async';
    duplicate?: boolean;
}

export interface UploadOptions {
    fileBuffer: Buffer;
    fileName: string;
    fileSize: number;
    mimeType: string;
    tenantId: string;
}

/**
 * Upload Service
 * 
 * Handles the complete file upload workflow including:
 * - Deduplication via content hash
 * - S3 storage
 * - Metadata persistence
 * - Async/sync processing routing
 */
@Injectable()
export class UploadService {
    private readonly logger = new Logger(UploadService.name);
    private readonly fileSizeThresholdMb: number;

    constructor(
        private readonly s3Service: S3Service,
        private readonly fileMetadataService: FileMetadataService,
        private readonly documentStatusService: DocumentStatusService,
        private readonly kinesisService: KinesisService,
        private readonly consumerService: ConsumerService,
    ) {
        this.fileSizeThresholdMb = parseFloat(process.env.FILE_SIZE_THRESHOLD_MB || '10');
    }

    /**
     * Process a file upload
     * 
     * Workflow:
     * 1. Compute content hash for deduplication
     * 2. Check for existing duplicate
     * 3. If new: upload to S3, save metadata, trigger processing
     * 4. If duplicate: return existing file metadata
     */
    async uploadFile(options: UploadOptions): Promise<UploadResult> {
        const { fileBuffer, fileName, fileSize, mimeType, tenantId } = options;

        // Step 1: Compute SHA-256 hash for deduplication
        const contentHash = this.computeContentHash(fileBuffer);

        // Step 2: Check for existing duplicate
        const existingFile = await this.fileMetadataService.findByContentHash(tenantId, contentHash);
        if (existingFile) {
            this.logger.log(`Duplicate file detected: ${existingFile.fileId} (hash: ${contentHash.substring(0, 16)}...)`);
            return {
                message: 'Duplicate file detected',
                fileId: existingFile.fileId,
                status: existingFile.status,
                duplicate: true,
            };
        }

        // Step 3: Process new file
        return this.processNewFile({
            fileBuffer,
            fileName,
            fileSize,
            mimeType,
            tenantId,
            contentHash,
        });
    }

    private computeContentHash(fileBuffer: Buffer): string {
        return crypto.createHash('sha256').update(fileBuffer).digest('hex');
    }

    private async processNewFile(options: {
        fileBuffer: Buffer;
        fileName: string;
        fileSize: number;
        mimeType: string;
        tenantId: string;
        contentHash: string;
    }): Promise<UploadResult> {
        const { fileBuffer, fileName, fileSize, mimeType, tenantId, contentHash } = options;

        const fileId = uuidv4();
        const isAsync = fileSize >= this.fileSizeThresholdMb * 1024 * 1024;

        try {
            // Upload to S3
            await this.s3Service.uploadPDF(
                fileId,
                tenantId,
                fileBuffer,
                fileName,
            );

            // Save metadata with content hash
            await this.fileMetadataService.saveFileMetadata({
                fileId,
                tenantId,
                fileName,
                fileSize,
                mimeType,
                s3Bucket: process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs',
                s3Key: `${tenantId}/${fileId}/${fileName}`,
                processingType: isAsync ? 'async' : 'sync',
                status: 'uploaded',
                contentHash,
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            // Create document status record
            await this.documentStatusService.createDocumentStatus(
                fileId,
                tenantId,
                0, // Total pages unknown until processed
            );

            // Route to async or sync processing
            if (isAsync) {
                await this.triggerAsyncProcessing(fileId, tenantId, fileName, fileSize);
            } else {
                this.triggerSyncProcessing(fileId, tenantId, fileName);
            }

            this.logger.log(`File uploaded successfully: ${fileId} (${isAsync ? 'Async' : 'Sync'})`);

            return {
                message: 'File uploaded successfully',
                fileId,
                status: 'uploaded',
                processingType: isAsync ? 'async' : 'sync',
            };
        } catch (error: any) {
            this.logger.error(`Upload failed: ${error.message}`, error.stack);
            throw new BadRequestException(`Upload failed: ${error.message}`);
        }
    }

    private async triggerAsyncProcessing(
        fileId: string,
        tenantId: string,
        fileName: string,
        fileSize: number,
    ): Promise<void> {
        await this.kinesisService.publishDocumentUploadEvent(fileId, tenantId, {
            fileName,
            fileSize,
            s3Key: `${tenantId}/${fileId}/${fileName}`,
            bucket: process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs',
        });
        this.logger.log(`Published async processing event for: ${fileId}`);
    }

    private triggerSyncProcessing(
        fileId: string,
        tenantId: string,
        fileName: string,
    ): void {
        this.logger.log(`Starting synchronous processing for: ${fileId}`);
        
        // Non-blocking sync processing
        this.consumerService.processDocument(
            fileId,
            tenantId,
            `${tenantId}/${fileId}/${fileName}`,
            process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs'
        ).catch(err => this.logger.error(`Sync processing failed for ${fileId}`, err));
    }
}
