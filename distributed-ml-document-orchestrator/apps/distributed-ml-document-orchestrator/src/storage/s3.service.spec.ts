import { Test, TestingModule } from '@nestjs/testing';
import { S3Module } from './s3.module';
import { S3Service } from './s3.service';

describe('S3Service - Local Tests', () => {
    let service: S3Service;

    beforeAll(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [S3Module],
            providers: [S3Service],
        }).compile();

        service = module.get<S3Service>(S3Service);
    });

    describe('File Operations', () => {
        const testFileId = `test-file-${Date.now()}`;
        const testTenantId = 'test-tenant';
        const testFileName = 'test-document.pdf';
        const testContent = Buffer.from('This is a test PDF content');

        it('should upload a PDF file', async () => {
            const result = await service.uploadPDF(testFileId, testTenantId, testContent, testFileName);

            expect(result).toBeDefined();
            expect(result.key).toContain(testFileId);
            expect(result.key).toContain(testTenantId);
            expect(result.bucket).toBe(process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs');
        });

        it('should check if file exists', async () => {
            const key = `${testTenantId}/${testFileId}/${testFileName}`;
            const bucket = process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs';

            const exists = await service.fileExists(bucket, key);
            expect(exists).toBe(true);
        });

        it('should get file metadata', async () => {
            const key = `${testTenantId}/${testFileId}/${testFileName}`;
            const bucket = process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs';

            const metadata = await service.getFileMetadata(bucket, key);

            expect(metadata).toBeDefined();
            expect(metadata.contentType).toBe('application/pdf');
            expect(metadata.contentLength).toBeGreaterThan(0);
        });

        it('should download a PDF file', async () => {
            const downloaded = await service.downloadPDF(testFileId, testTenantId, testFileName);

            expect(downloaded).toBeDefined();
            expect(downloaded.toString()).toBe(testContent.toString());
        });

        it('should generate presigned upload URL', async () => {
            const key = `${testTenantId}/${testFileId}/presigned-test.pdf`;
            const bucket = process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs';

            const url = await service.getPresignedUploadUrl({ bucket, key, expiresIn: 300 });

            expect(url).toBeDefined();
            expect(url).toContain(bucket);
            expect(url).toContain(key);
        });

        it('should generate presigned download URL', async () => {
            const key = `${testTenantId}/${testFileId}/${testFileName}`;
            const bucket = process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs';

            const url = await service.getPresignedDownloadUrl({ bucket, key, expiresIn: 300 });

            expect(url).toBeDefined();
            expect(url).toContain(bucket);
            expect(url).toContain(key);
        });

        it('should upload results JSON', async () => {
            const results = {
                fileId: testFileId,
                analysis: 'Test analysis',
            };

            const result = await service.uploadResults(testFileId, testTenantId, results);

            expect(result).toBeDefined();
            expect(result.key).toContain('results.json');
        });

        it('should delete a file', async () => {
            const key = `${testTenantId}/${testFileId}/${testFileName}`;
            const bucket = process.env.S3_BUCKET_NAME || 'document-orchestrator-pdfs';

            await service.deleteFile(bucket, key);

            const exists = await service.fileExists(bucket, key);
            expect(exists).toBe(false);
        });
    });
});
