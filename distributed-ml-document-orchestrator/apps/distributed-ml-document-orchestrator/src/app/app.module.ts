import { Module } from '@nestjs/common';
import { DynamoDBModule } from '../database/dynamodb.module';
import { FileMetadataService } from '../database/file-metadata.service';
import { DocumentStatusService } from '../database/document-status.service';
import { S3Module } from '../storage/s3.module';
import { S3Service } from '../storage/s3.service';
import { KinesisModule } from '../queue/kinesis.module';
import { KinesisService } from '../queue/kinesis.service';
import { GeminiModule } from '../ml/gemini.module';
import { ConsumerModule } from '../consumer/consumer.module';
import { AggregatorModule } from '../aggregator/aggregator.module';
import { UploadController } from './upload.controller';
import { JobsController } from './jobs.controller';

@Module({
    imports: [
        DynamoDBModule,
        S3Module,
        KinesisModule,
        ConsumerModule,
        GeminiModule,
        AggregatorModule,
    ],
    controllers: [UploadController, JobsController],
    providers: [
        FileMetadataService,
        DocumentStatusService,
        S3Service,
        KinesisService,
    ],
    exports: [FileMetadataService, DocumentStatusService, S3Service, KinesisService],
})
export class AppModule { }
