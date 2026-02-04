import { Module } from '@nestjs/common';
import { ReaperService } from './reaper.service';
import { DynamoDBModule } from '../database/dynamodb.module';

@Module({
    imports: [DynamoDBModule],
    providers: [ReaperService],
    exports: [ReaperService],
})
export class ReaperModule { }
