/**
 * LLM Provider Interface
 * 
 * Abstraction layer for different LLM providers.
 * Implement this interface to add new providers (Gemini, Bedrock, OpenAI, etc.)
 */

export interface AnalysisResult {
    summary: string;
    entities: string[];
    keyPoints: string[];
    sentiment: string;
    [key: string]: any;
}

export interface LLMProvider {
    readonly name: string;
    readonly model: string;
    
    /**
     * Analyze a text chunk and return structured results
     */
    analyzeChunk(text: string): Promise<AnalysisResult>;
    
    /**
     * Check if the provider is properly configured and accessible
     */
    healthCheck(): Promise<boolean>;
}

export const LLM_PROVIDER_TOKEN = Symbol('LLM_PROVIDER');
