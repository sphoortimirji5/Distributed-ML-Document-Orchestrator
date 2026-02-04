import { Injectable, Logger } from '@nestjs/common';
import { LLMProvider } from './llm-provider.interface';
import { GeminiProvider } from './gemini.provider';
import { BedrockProvider } from './bedrock.provider';

/** Creates LLM provider based on LLM_PROVIDER env var */
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
