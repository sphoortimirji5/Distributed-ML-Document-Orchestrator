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
import { UploadService } from '../upload/upload.service';
import { Express } from 'express';
import 'multer';

/**
 * Upload Controller
 * 
 * Handles HTTP requests for file uploads.
 * Delegates all business logic to UploadService.
 */
@Controller('upload')
export class UploadController {
    private readonly logger = new Logger(UploadController.name);

    constructor(private readonly uploadService: UploadService) {}

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

        return this.uploadService.uploadFile({
            fileBuffer: file.buffer,
            fileName: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            tenantId,
        });
    }
}
