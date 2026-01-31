import { Injectable, Logger, Inject } from '@nestjs/common';
import { LLMProvider, AnalysisResult, LLM_PROVIDER_TOKEN } from './llm-provider.interface';

/**
 * LLM Service
 * 
 * High-level service for document analysis.
 * Uses the configured LLM provider (Gemini, Bedrock, etc.)
 * via dependency injection.
 */
@Injectable()
export class GeminiService {
    private readonly logger = new Logger(GeminiService.name);

    constructor(
        @Inject(LLM_PROVIDER_TOKEN)
        private readonly llmProvider: LLMProvider,
    ) {
        this.logger.log(`LLM Service initialized with provider: ${this.llmProvider.name}`);
    }

    /**
     * Analyze a text chunk using the configured LLM provider
     */
    async analyzeChunk(text: string): Promise<AnalysisResult> {
        return this.llmProvider.analyzeChunk(text);
    }

    /**
     * Get the name of the current LLM provider
     */
    getProviderName(): string {
        return this.llmProvider.name;
    }

    /**
     * Get the model being used by the current provider
     */
    getModelName(): string {
        return this.llmProvider.model;
    }

    /**
     * Check if the LLM provider is healthy
     */
    async healthCheck(): Promise<boolean> {
        return this.llmProvider.healthCheck();
    }
}
