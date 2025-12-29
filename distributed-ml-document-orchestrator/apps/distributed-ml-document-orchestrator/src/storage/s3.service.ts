import { Injectable, Inject, Logger } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import {
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

export interface UploadOptions {
    bucket: string;
    key: string;
    body: Buffer | Readable;
    contentType?: string;
    metadata?: Record<string, string>;
}

export interface PresignedUrlOptions {
    bucket: string;
    key: string;
    expiresIn?: number; // seconds, default 3600 (1 hour)
}

export interface FileMetadata {
    contentType?: string;
    contentLength?: number;
    lastModified?: Date;
    metadata?: Record<string, string>;
}

@Injectable()
export class S3Service {
    private readonly logger = new Logger(S3Service.name);
    private readonly pdfBucket: string;
    private readonly resultsBucket: string;

    constructor(
        @Inject('S3_CLIENT')
        private readonly s3Client: S3Client,
    ) {
        this.pdfBucket = process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs';
        this.resultsBucket = process.env.S3_RESULTS_BUCKET || 'document-orchestrator-results';
    }

    /**
     * Uploads a file to a specified S3 bucket.
     * Handles the low-level PutObjectCommand and provides logging for successful uploads.
     */
    async uploadFile(options: UploadOptions): Promise<{ key: string; bucket: string }> {
        const { bucket, key, body, contentType, metadata } = options;

        try {
            await this.s3Client.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: body,
                    ContentType: contentType,
                    Metadata: metadata,
                }),
            );

            this.logger.log(`File uploaded successfully: s3://${bucket}/${key}`);
            return { key, bucket };
        } catch (error) {
            this.logger.error(`Failed to upload file to S3: ${error.message}`, error.stack);
            throw new Error(`S3 upload failed: ${error.message}`);
        }
    }

    /**
     * Specialized method for uploading PDF documents to the primary storage bucket.
     * Automatically sets the content type and includes relevant document metadata.
     */
    async uploadPDF(
        fileId: string,
        tenantId: string,
        body: Buffer | Readable,
        fileName: string,
    ): Promise<{ key: string; bucket: string }> {
        const key = `${tenantId}/${fileId}/${fileName}`;

        return this.uploadFile({
            bucket: this.pdfBucket,
            key,
            body,
            contentType: 'application/pdf',
            metadata: {
                fileId,
                tenantId,
                originalFileName: fileName,
                uploadedAt: new Date().toISOString(),
            },
        });
    }

    /**
     * Persists the final aggregated analysis results to the designated results bucket.
     * Formats the results as a pretty-printed JSON file.
     */
    async uploadResults(
        fileId: string,
        tenantId: string,
        results: unknown,
    ): Promise<{ key: string; bucket: string }> {
        const key = `${tenantId}/${fileId}/results.json`;

        return this.uploadFile({
            bucket: this.resultsBucket,
            key,
            body: Buffer.from(JSON.stringify(results, null, 2)),
            contentType: 'application/json',
            metadata: {
                fileId,
                tenantId,
                processedAt: new Date().toISOString(),
            },
        });
    }

    /**
     * Retrieves a file from S3 and returns its content as a Buffer.
     * Handles the stream-to-buffer conversion internally.
     */
    async downloadFile(bucket: string, key: string): Promise<Buffer> {
        try {
            const response = await this.s3Client.send(
                new GetObjectCommand({
                    Bucket: bucket,
                    Key: key,
                }),
            );

            // Convert stream to buffer
            const stream = response.Body as Readable;
            const chunks: Buffer[] = [];

            return new Promise((resolve, reject) => {
                stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                stream.on('error', reject);
                stream.on('end', () => resolve(Buffer.concat(chunks)));
            });
        } catch (error) {
            this.logger.error(`Failed to download file from S3: ${error.message}`, error.stack);
            throw new Error(`S3 download failed: ${error.message}`);
        }
    }

    /**
     * Convenience method for downloading a PDF document from the primary storage bucket.
     */
    async downloadPDF(fileId: string, tenantId: string, fileName: string): Promise<Buffer> {
        const key = `${tenantId}/${fileId}/${fileName}`;
        return this.downloadFile(this.pdfBucket, key);
    }

    /**
     * Retrieves object metadata (headers) from S3 without downloading the actual content.
     */
    async getFileMetadata(bucket: string, key: string): Promise<FileMetadata> {
        try {
            const response = await this.s3Client.send(
                new HeadObjectCommand({
                    Bucket: bucket,
                    Key: key,
                }),
            );

            return {
                contentType: response.ContentType,
                contentLength: response.ContentLength,
                lastModified: response.LastModified,
                metadata: response.Metadata,
            };
        } catch (error) {
            this.logger.error(`Failed to get file metadata: ${error.message}`, error.stack);
            throw new Error(`Failed to get file metadata: ${error.message}`);
        }
    }

    /**
     * Generates a time-limited pre-signed URL that allows a client to upload a file directly to S3.
     */
    async getPresignedUploadUrl(options: PresignedUrlOptions): Promise<string> {
        const { bucket, key, expiresIn = 3600 } = options;

        try {
            const command = new PutObjectCommand({
                Bucket: bucket,
                Key: key,
            });

            const url = await getSignedUrl(this.s3Client, command, { expiresIn });
            this.logger.log(`Generated presigned upload URL for: s3://${bucket}/${key}`);
            return url;
        } catch (error) {
            this.logger.error(`Failed to generate presigned upload URL: ${error.message}`, error.stack);
            throw new Error(`Failed to generate presigned URL: ${error.message}`);
        }
    }

    /**
     * Generate presigned URL for download (alias for getPresignedUrl)
     */
    async getPresignedDownloadUrl(options: PresignedUrlOptions): Promise<string> {
        return this.getPresignedUrl(options);
    }

    /**
     * Generates a time-limited pre-signed URL that allows a client to download a file directly from S3.
     */
    async getPresignedUrl(options: PresignedUrlOptions): Promise<string> {
        const { bucket, key, expiresIn = 3600 } = options;

        try {
            const command = new GetObjectCommand({
                Bucket: bucket,
                Key: key,
            });

            const url = await getSignedUrl(this.s3Client, command, { expiresIn });
            this.logger.log(`Generated presigned download URL for: s3://${bucket}/${key}`);
            return url;
        } catch (error) {
            this.logger.error(`Failed to generate presigned download URL: ${error.message}`, error.stack);
            throw new Error(`Failed to generate presigned URL: ${error.message}`);
        }
    }

    /**
     * Delete a file from S3
     */
    async deleteFile(bucket: string, key: string): Promise<void> {
        try {
            await this.s3Client.send(
                new DeleteObjectCommand({
                    Bucket: bucket,
                    Key: key,
                }),
            );

            this.logger.log(`File deleted successfully: s3://${bucket}/${key}`);
        } catch (error) {
            this.logger.error(`Failed to delete file from S3: ${error.message}`, error.stack);
            throw new Error(`S3 delete failed: ${error.message}`);
        }
    }

    /**
     * Copy a file within S3
     */
    async copyFile(
        sourceBucket: string,
        sourceKey: string,
        destBucket: string,
        destKey: string,
    ): Promise<void> {
        try {
            await this.s3Client.send(
                new CopyObjectCommand({
                    CopySource: `${sourceBucket}/${sourceKey}`,
                    Bucket: destBucket,
                    Key: destKey,
                }),
            );

            this.logger.log(`File copied: s3://${sourceBucket}/${sourceKey} -> s3://${destBucket}/${destKey}`);
        } catch (error) {
            this.logger.error(`Failed to copy file in S3: ${error.message}`, error.stack);
            throw new Error(`S3 copy failed: ${error.message}`);
        }
    }

    /**
     * Check if file exists
     */
    async fileExists(bucket: string, key: string): Promise<boolean> {
        try {
            await this.s3Client.send(
                new HeadObjectCommand({
                    Bucket: bucket,
                    Key: key,
                }),
            );
            return true;
        } catch (error) {
            if (error.name === 'NotFound') {
                return false;
            }
            throw error;
        }
    }
}
