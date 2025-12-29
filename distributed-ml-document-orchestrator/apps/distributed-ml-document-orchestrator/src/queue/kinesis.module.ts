import { Module, Global } from '@nestjs/common';
import { KinesisClient } from '@aws-sdk/client-kinesis';

import { KinesisService } from './kinesis.service';

@Global()
@Module({
    providers: [
        {
            provide: 'KINESIS_CLIENT',
            useFactory: () => {
                return new KinesisClient({
                    region: process.env.AWS_REGION || 'us-east-1',
                    ...(process.env.AWS_ENDPOINT_URL && {
                        endpoint: process.env.AWS_ENDPOINT_URL,
                    }),
                    credentials: {
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
                    },
                });
            },
        },
        KinesisService,
    ],
    exports: ['KINESIS_CLIENT', KinesisService],
})
export class KinesisModule { }
