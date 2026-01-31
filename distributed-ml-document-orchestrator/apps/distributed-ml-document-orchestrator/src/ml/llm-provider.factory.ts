import { Injectable, Logger } from '@nestjs/common';
import { LLMProvider } from './llm-provider.interface';
import { GeminiProvider } from './gemini.provider';
import { BedrockProvider } from './bedrock.provider';

/**
 * LLM Provider Factory
 * 
 * Creates the appropriate LLM provider based on environment configuration.
 * 
 * Configuration:
 * - LLM_PROVIDER=gemini (default) - Uses Google Gemini API
 * - LLM_PROVIDER=bedrock - Uses AWS Bedrock with IAM authentication
 * 
 * Environment variables:
 * - GEMINI_API_KEY - Required for Gemini provider
 * - GEMINI_MODEL - Optional, defaults to 'gemini-2.0-flash-lite'
 * - BEDROCK_MODEL - Optional, defaults to 'anthropic.claude-3-sonnet-20240229-v1:0'
 */
@Injectable()
export class LLMProviderFactory {
    private readonly logger = new Logger(LLMProviderFactory.name);

    createProvider(): LLMProvider {
        const providerType = process.env.LLM_PROVIDER?.toLowerCase() || 'gemini';

        switch (providerType) {
            case 'bedrock':
                this.logger.log('Creating Bedrock provider (IAM authentication)');
                return new BedrockProvider();
            
            case 'gemini':
                this.logger.log('Creating Gemini provider (API key authentication)');
                return new GeminiProvider();
            
            default:
                this.logger.warn(`Unknown provider "${providerType}", defaulting to Gemini`);
                return new GeminiProvider();
        }
    }
}
