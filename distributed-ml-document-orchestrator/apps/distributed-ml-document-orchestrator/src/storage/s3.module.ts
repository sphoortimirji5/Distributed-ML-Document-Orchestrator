import { Module, Global } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';

import { S3Service } from './s3.service';

@Global()
@Module({
    providers: [
        {
            provide: 'S3_CLIENT',
            useFactory: () => {
                return new S3Client({
                    region: process.env.AWS_REGION || 'us-east-1',
                    ...(process.env.AWS_ENDPOINT_URL && {
                        endpoint: process.env.AWS_ENDPOINT_URL,
                        forcePathStyle: true, // Required for LocalStack
                    }),
                    credentials: {
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
                    },
                });
            },
        },
        S3Service,
    ],
    exports: ['S3_CLIENT', S3Service],
})
export class S3Module { }
