import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, AnalysisResult } from './llm-provider.interface';

/**
 * Google Gemini LLM Provider
 * 
 * Uses API key authentication via environment variable.
 * Suitable for development and testing environments.
 */
@Injectable()
export class GeminiProvider implements LLMProvider {
    private readonly logger = new Logger(GeminiProvider.name);
    private readonly genAI: GoogleGenerativeAI;
    private readonly modelInstance: any;
    
    readonly name = 'gemini';
    readonly model: string;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            this.logger.error('GEMINI_API_KEY is not defined in environment variables');
            throw new Error('GEMINI_API_KEY is missing');
        }
        
        this.model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.modelInstance = this.genAI.getGenerativeModel({ model: this.model });
        
        this.logger.log(`Initialized Gemini provider with model: ${this.model}`);
    }

    async analyzeChunk(text: string, retries = 3, delay = 2000): Promise<AnalysisResult> {
        this.logger.log(`Analyzing text with Gemini (${this.model}) (Retries left: ${retries})...`);

        const prompt = this.buildPrompt(text);

        try {
            const result = await this.modelInstance.generateContent(prompt);
            const response = await result.response;
            const responseText = response.text();

            return this.parseResponse(responseText);
        } catch (error: any) {
            // Handle rate limiting with exponential backoff
            if (error.message?.includes('429') && retries > 0) {
                this.logger.warn(`Rate limit hit, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.analyzeChunk(text, retries - 1, delay * 2);
            }
            
            this.logger.error(`Gemini analysis failed: ${error.message}`, error.stack);
            throw new Error(`Gemini analysis failed: ${error.message}`);
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            await this.analyzeChunk('Test');
            return true;
        } catch (error) {
            this.logger.error('Gemini health check failed', error);
            return false;
        }
    }

    private buildPrompt(text: string): string {
        return `Analyze the following text from a single page of a document and provide a structured JSON response.
            The JSON should include:
            1. "summary": A brief summary of the page content.
            2. "entities": A list of key entities (people, organizations, locations, etc.) mentioned on this page.
            3. "keyPoints": A list of main points discussed on this page.
            4. "sentiment": The overall sentiment of the text.

            Text:
            ${text}

            Return ONLY the JSON object.`;
    }

    private parseResponse(responseText: string): AnalysisResult {
        // Attempt to extract JSON from the response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return JSON.parse(responseText);
    }
}
