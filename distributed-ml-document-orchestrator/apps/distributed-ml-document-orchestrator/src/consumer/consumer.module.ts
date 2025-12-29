import { Module } from '@nestjs/common';
import { ConsumerService } from './consumer.service';
import { S3Module } from '../storage/s3.module';
import { KinesisModule } from '../queue/kinesis.module';
import { FileMetadataService } from '../database/file-metadata.service';
import { DocumentStatusService } from '../database/document-status.service';
import { DynamoDBModule } from '../database/dynamodb.module';

import { GeminiModule } from '../ml/gemini.module';
import { GeminiService } from '../ml/gemini.service';

@Module({
    imports: [S3Module, KinesisModule, DynamoDBModule, GeminiModule],
    providers: [ConsumerService],
    exports: [ConsumerService],
})
export class ConsumerModule { }
