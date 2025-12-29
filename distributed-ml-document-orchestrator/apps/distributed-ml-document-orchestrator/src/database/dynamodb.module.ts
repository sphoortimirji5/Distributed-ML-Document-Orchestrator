import { Module, Global } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { FileMetadataService } from './file-metadata.service';
import { DocumentStatusService } from './document-status.service';

@Global()
@Module({
    providers: [
        {
            provide: 'DYNAMODB_CLIENT',
            useFactory: () => {
                const client = new DynamoDBClient({
                    region: process.env.AWS_REGION || 'us-east-1',
                    ...(process.env.AWS_ENDPOINT_URL && {
                        endpoint: process.env.AWS_ENDPOINT_URL,
                    }),
                    credentials: {
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
                    },
                });

                // Create DynamoDB Document Client for easier data manipulation
                return DynamoDBDocumentClient.from(client, {
                    marshallOptions: {
                        removeUndefinedValues: true,
                        convertClassInstanceToMap: true,
                    },
                });
            },
        },
        FileMetadataService,
        DocumentStatusService,
    ],
    exports: ['DYNAMODB_CLIENT', FileMetadataService, DocumentStatusService],
})
export class DynamoDBModule { }
