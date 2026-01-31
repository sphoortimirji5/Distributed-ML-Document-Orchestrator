import { Module, Global } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { LLM_PROVIDER_TOKEN } from './llm-provider.interface';
import { LLMProviderFactory } from './llm-provider.factory';

/**
 * LLM Module
 * 
 * Provides LLM capabilities via configurable providers (Gemini, Bedrock, etc.)
 * 
 * Configuration:
 * - LLM_PROVIDER=gemini|bedrock - Select provider (default: gemini)
 * - GEMINI_API_KEY - Required for Gemini
 * - BEDROCK_MODEL - Optional model ID for Bedrock
 * 
 * In production with ECS:
 * - Set LLM_PROVIDER=bedrock
 * - Ensure Task Role has bedrock:InvokeModel permission
 * - No API keys needed in environment (uses IAM)
 */
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
