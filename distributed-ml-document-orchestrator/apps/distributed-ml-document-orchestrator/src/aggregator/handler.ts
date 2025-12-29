import { NestFactory } from '@nestjs/core';
import { AggregatorModule } from './aggregator.module';
import { AggregatorService } from './aggregator.service';
import { DynamoDBStreamEvent } from 'aws-lambda';

let cachedService: AggregatorService;

async function getAggregatorService(): Promise<AggregatorService> {
    if (!cachedService) {
        const app = await NestFactory.createApplicationContext(AggregatorModule);
        cachedService = app.get(AggregatorService);
    }
    return cachedService;
}

export const handler = async (event: DynamoDBStreamEvent) => {
    const service = await getAggregatorService();

    for (const record of event.Records) {
        if (record.eventName !== 'MODIFY') continue;

        const newImage = record.dynamodb.NewImage as any;
        const oldImage = record.dynamodb.OldImage as any;

        if (!newImage || !oldImage) continue;

        // Check if it's a STATUS record
        if (newImage.SK.S !== 'STATUS') continue;

        const fileId = newImage.fileId.S;
        const tenantId = newImage.tenantId.S;
        const totalPages = parseInt(newImage.totalPages.N);
        const processedPages = parseInt(newImage.processedPages.N);
        const overallStatus = newImage.overallStatus.S;

        // Trigger aggregation only when processing is complete and not already aggregating/completed
        if (
            processedPages === totalPages &&
            totalPages > 0 &&
            overallStatus === 'processing'
        ) {
            console.log(`Triggering aggregation for ${fileId}`);
            await service.aggregateResults(fileId, tenantId, totalPages);
        }
    }
};
