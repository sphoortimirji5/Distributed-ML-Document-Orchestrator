import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { S3Module } from '../storage/s3.module';
import { DynamoDBModule } from '../database/dynamodb.module';
import { KinesisModule } from '../queue/kinesis.module';
import { ConsumerModule } from '../consumer/consumer.module';

@Module({
    imports: [S3Module, DynamoDBModule, KinesisModule, ConsumerModule],
    providers: [UploadService],
    exports: [UploadService],
})
export class UploadModule { }

