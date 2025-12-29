import {
    Controller,
    Post,
    UseInterceptors,
    UploadedFile,
    Body,
    BadRequestException,
    Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { S3Service } from '../storage/s3.service';
import { FileMetadataService } from '../database/file-metadata.service';
import { DocumentStatusService } from '../database/document-status.service';
import { KinesisService } from '../queue/kinesis.service';
import { ConsumerService } from '../consumer/consumer.service';
import { Express } from 'express';
import 'multer';
import { v4 as uuidv4 } from 'uuid';

@Controller('upload')
export class UploadController {
    private readonly logger = new Logger(UploadController.name);

    constructor(
        private readonly s3Service: S3Service,
        private readonly fileMetadataService: FileMetadataService,
        private readonly documentStatusService: DocumentStatusService,
        private readonly kinesisService: KinesisService,
        private readonly consumerService: ConsumerService,
    ) { }

    @Post()
    @UseInterceptors(FileInterceptor('file'))
    async uploadFile(
        @UploadedFile() file: Express.Multer.File,
        @Body('tenantId') tenantId: string,
    ) {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }
        if (!tenantId) {
            throw new BadRequestException('Tenant ID is required');
        }

        const fileId = uuidv4();
        const thresholdMb = parseFloat(process.env.FILE_SIZE_THRESHOLD_MB || '10');
        const isAsync = file.size >= thresholdMb * 1024 * 1024;

        try {
            // Persist the uploaded PDF to S3 storage
            await this.s3Service.uploadPDF(
                fileId,
                tenantId,
                file.buffer,
                file.originalname,
            );

            // Record file metadata in the database for tracking and retrieval
            await this.fileMetadataService.saveFileMetadata({
                fileId,
                tenantId,
                fileName: file.originalname,
                fileSize: file.size,
                mimeType: file.mimetype,
                s3Bucket: process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs',
                s3Key: `${tenantId}/${fileId}/${file.originalname}`,
                processingType: isAsync ? 'async' : 'sync',
                status: 'uploaded',
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            // Initialize the document status record to begin tracking the processing lifecycle
            await this.documentStatusService.createDocumentStatus(
                fileId,
                tenantId,
                0, // Total pages unknown until processed
            );

            // Determine the processing strategy based on file size and trigger the appropriate workflow
            if (isAsync) {
                await this.kinesisService.publishDocumentUploadEvent(fileId, tenantId, {
                    fileName: file.originalname,
                    fileSize: file.size,
                    s3Key: `${tenantId}/${fileId}/${file.originalname}`,
                    bucket: process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs',
                });
                this.logger.log(`Published async processing event for: ${fileId}`);
            } else {
                // Synchronous processing
                this.logger.log(`Starting synchronous processing for: ${fileId}`);
                this.consumerService.processDocument(
                    fileId,
                    tenantId,
                    `${tenantId}/${fileId}/${file.originalname}`,
                    process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs'
                ).catch(err => this.logger.error(`Sync processing failed for ${fileId}`, err));
            }

            this.logger.log(`File uploaded successfully: ${fileId} (${isAsync ? 'Async' : 'Sync'})`);

            return {
                message: 'File uploaded successfully',
                fileId,
                status: 'uploaded',
                processingType: isAsync ? 'async' : 'sync',
            };
        } catch (error) {
            this.logger.error(`Upload failed: ${error.message}`, error.stack);
            throw new BadRequestException(`Upload failed: ${error.message}`);
        }
    }
}
