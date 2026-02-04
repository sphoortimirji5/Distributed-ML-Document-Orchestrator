import { Module, Global } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { LLM_PROVIDER_TOKEN } from './llm-provider.interface';
import { LLMProviderFactory } from './llm-provider.factory';

/** LLM Module - Configures provider via LLM_PROVIDER env var (gemini|bedrock) */
@Global()
@Module({
    providers: [
        LLMProviderFactory,
        {
            provide: LLM_PROVIDER_TOKEN,
            useFactory: (factory: LLMProviderFactory) => factory.createProvider(),
            inject: [LLMProviderFactory],
        },
        GeminiService,
    ],
    exports: [GeminiService, LLM_PROVIDER_TOKEN],
})
export class GeminiModule { }
