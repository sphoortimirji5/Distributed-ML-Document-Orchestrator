import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
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
import { UploadModule } from '../upload/upload.module';
import { ReaperModule } from '../reaper/reaper.module';
import { UploadService } from '../upload/upload.service';
import { UploadController } from './upload.controller';
import { JobsController } from './jobs.controller';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        DynamoDBModule,
        S3Module,
        KinesisModule,
        ConsumerModule,
        GeminiModule,
        AggregatorModule,
        UploadModule,
        ReaperModule,
    ],
    controllers: [UploadController, JobsController],
    providers: [
        FileMetadataService,
        DocumentStatusService,
        S3Service,
        KinesisService,
        UploadService,
    ],
    exports: [FileMetadataService, DocumentStatusService, S3Service, KinesisService, UploadService],
})
export class AppModule { }
