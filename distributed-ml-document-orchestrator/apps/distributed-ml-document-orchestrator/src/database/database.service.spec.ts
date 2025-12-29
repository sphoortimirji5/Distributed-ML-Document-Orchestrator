import { Test, TestingModule } from '@nestjs/testing';
import { DynamoDBModule } from './dynamodb.module';
import { FileMetadataService } from './file-metadata.service';
import { DocumentStatusService } from './document-status.service';

describe('DynamoDB Services - Local Tests', () => {
    let fileMetadataService: FileMetadataService;
    let documentStatusService: DocumentStatusService;

    beforeAll(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [DynamoDBModule],
            providers: [FileMetadataService, DocumentStatusService],
        }).compile();

        fileMetadataService = module.get<FileMetadataService>(FileMetadataService);
        documentStatusService = module.get<DocumentStatusService>(DocumentStatusService);
    });

    describe('FileMetadataService', () => {
        const testFileId = `test-file-${Date.now()}`;
        const testTenantId = 'test-tenant';

        it('should save file metadata', async () => {
            const metadata = await fileMetadataService.saveFileMetadata({
                fileId: testFileId,
                fileName: 'test-document.pdf',
                fileSize: 1024000,
                mimeType: 'application/pdf',
                s3Key: `uploads/${testFileId}.pdf`,
                s3Bucket: 'document-orchestrator-pdfs',
                tenantId: testTenantId,
                userId: 'user-123',
                processingType: 'async',
                status: 'uploaded',
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            expect(metadata).toBeDefined();
            expect(metadata.fileId).toBe(testFileId);
            expect(metadata.status).toBe('uploaded');
            expect(metadata.PK).toBe(`FILE#${testFileId}`);
            expect(metadata.SK).toBe('METADATA');
        });

        it('should retrieve file metadata', async () => {
            const metadata = await fileMetadataService.getFileMetadata(testFileId);

            expect(metadata).toBeDefined();
            expect(metadata?.fileId).toBe(testFileId);
            expect(metadata?.fileName).toBe('test-document.pdf');
        });

        it('should update file status', async () => {
            await fileMetadataService.updateFileStatus(testFileId, 'processing');

            const metadata = await fileMetadataService.getFileMetadata(testFileId);
            expect(metadata?.status).toBe('processing');
        });

        it('should query files by tenant', async () => {
            const files = await fileMetadataService.getFilesByTenant(testTenantId);

            expect(files).toBeDefined();
            expect(Array.isArray(files)).toBe(true);
            expect(files.length).toBeGreaterThan(0);
            expect(files[0].tenantId).toBe(testTenantId);
        });

        it('should delete file metadata', async () => {
            await fileMetadataService.deleteFileMetadata(testFileId);

            const metadata = await fileMetadataService.getFileMetadata(testFileId);
            expect(metadata).toBeNull();
        });
    });

    describe('DocumentStatusService', () => {
        const testFileId = `test-doc-${Date.now()}`;
        const testTenantId = 'test-tenant';

        it('should create document status', async () => {
            const status = await documentStatusService.createDocumentStatus(
                testFileId,
                testTenantId,
                10, // 10 pages
            );

            expect(status).toBeDefined();
            expect(status.fileId).toBe(testFileId);
            expect(status.overallStatus).toBe('pending');
            expect(status.totalPages).toBe(10);
            expect(status.processedPages).toBe(0);
            expect(status.PK).toBe(`DOC#${testFileId}`);
            expect(status.SK).toBe('STATUS');
        });

        it('should retrieve document status', async () => {
            const status = await documentStatusService.getDocumentStatus(testFileId);

            expect(status).toBeDefined();
            expect(status?.fileId).toBe(testFileId);
            expect(status?.totalPages).toBe(10);
        });

        it('should update document status', async () => {
            await documentStatusService.updateDocumentStatus(testFileId, {
                overallStatus: 'processing',
                processedPages: 5,
            });

            const status = await documentStatusService.getDocumentStatus(testFileId);
            expect(status?.overallStatus).toBe('processing');
            expect(status?.processedPages).toBe(5);
        });

        it('should save page attributes', async () => {
            const pageData = await documentStatusService.savePageAttributes(
                testFileId,
                testTenantId,
                1,
                JSON.stringify({ summary: 'test' }),
                ['chunk-1', 'chunk-2'],
            );

            expect(pageData).toBeDefined();
            expect(pageData.pageNumber).toBe(1);
            expect(pageData.pageAnalysis).toBeDefined();
            expect(pageData.PK).toBe(`DOC#${testFileId}`);
            expect(pageData.SK).toBe('PAGE#0001');
        });

        it('should retrieve specific page', async () => {
            const page = await documentStatusService.getPage(testFileId, 1);

            expect(page).toBeDefined();
            expect(page?.pageNumber).toBe(1);
            expect(page?.pageAnalysis).toBeDefined();
        });

        it('should retrieve all document pages', async () => {
            // Save another page
            await documentStatusService.savePageAttributes(
                testFileId,
                testTenantId,
                2,
                JSON.stringify({ summary: 'page 2' }),
            );

            const pages = await documentStatusService.getDocumentPages(testFileId);

            expect(pages).toBeDefined();
            expect(Array.isArray(pages)).toBe(true);
            expect(pages.length).toBeGreaterThanOrEqual(2);
        });

        it('should increment processed pages', async () => {
            await documentStatusService.incrementProcessedPages(testFileId);

            const status = await documentStatusService.getDocumentStatus(testFileId);
            expect(status?.processedPages).toBeGreaterThan(5);
        });

        it('should query documents by status for tenant', async () => {
            const documents = await documentStatusService.getDocumentsByStatus(testTenantId);

            expect(documents).toBeDefined();
            expect(Array.isArray(documents)).toBe(true);
            expect(documents.length).toBeGreaterThan(0);
        });
    });
});
