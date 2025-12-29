import { Module } from '@nestjs/common';
import { AggregatorService } from './aggregator.service';
import { StreamPollerService } from './stream-poller.service';
import { DynamoDBModule } from '../database/dynamodb.module';
import { S3Module } from '../storage/s3.module';
import { DocumentStatusService } from '../database/document-status.service';

@Module({
    imports: [DynamoDBModule, S3Module],
    providers: [AggregatorService, DocumentStatusService, StreamPollerService],
    exports: [AggregatorService],
})
export class AggregatorModule { }
