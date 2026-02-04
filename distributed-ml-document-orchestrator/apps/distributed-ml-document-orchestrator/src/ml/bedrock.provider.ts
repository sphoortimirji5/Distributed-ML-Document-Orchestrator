import { Injectable, Logger } from '@nestjs/common';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { LLMProvider, AnalysisResult } from './llm-provider.interface';

/** AWS Bedrock LLM Provider - Uses IAM Task Role authentication */
@Injectable()
export class BedrockProvider implements LLMProvider {
    private readonly logger = new Logger(BedrockProvider.name);
    private readonly client: BedrockRuntimeClient;

    readonly name = 'bedrock';
    readonly model: string;

    constructor() {
        const region = process.env.AWS_REGION || 'us-east-1';

        const model = process.env.LLM_MODEL;
        if (!model) {
            this.logger.error('LLM_MODEL environment variable is required');
            throw new Error('LLM_MODEL environment variable is required');
        }
        this.model = model;

        this.client = new BedrockRuntimeClient({ region });

        this.logger.log(`Initialized Bedrock provider with model: ${this.model}`);
    }

    async analyzeChunk(text: string, retries = 3, delay = 1000): Promise<AnalysisResult> {
        this.logger.log(`Analyzing text with Bedrock (${this.model})...`);

        const prompt = this.buildPrompt(text);

        try {
            const command = new InvokeModelCommand({
                modelId: this.model,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(this.buildRequestBody(prompt)),
            });

            const response = await this.client.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            return this.parseResponse(responseBody);
        } catch (error: any) {
            if (error.name === 'ThrottlingException' && retries > 0) {
                this.logger.warn(`Bedrock throttled, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.analyzeChunk(text, retries - 1, delay * 2);
            }

            this.logger.error(`Bedrock analysis failed: ${error.message}`, error.stack);
            throw new Error(`Bedrock analysis failed: ${error.message}`);
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            await this.analyzeChunk('Test');
            return true;
        } catch (error) {
            this.logger.error('Bedrock health check failed', error);
            return false;
        }
    }

    private buildPrompt(text: string): string {
        return `Analyze the following text from a document and provide a structured JSON response with these fields:
- "summary": A brief summary of the content
- "entities": An array of key entities (people, organizations, locations) mentioned
- "keyPoints": An array of main points discussed
- "sentiment": The overall sentiment (positive, negative, or neutral)

Text to analyze:
${text}

Return ONLY the JSON object, no other text.`;
    }

    private buildRequestBody(prompt: string): any {
        if (this.model.includes('claude')) {
            return {
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 4096,
                messages: [{ role: 'user', content: prompt }],
            };
        }
        return { prompt, max_tokens: 4096, temperature: 0.7 };
    }

    private parseResponse(responseBody: any): AnalysisResult {
        try {
            let content = '';
            if (responseBody.content && Array.isArray(responseBody.content)) {
                content = responseBody.content.map((c: any) => c.text).join('');
            } else if (responseBody.completion) {
                content = responseBody.completion;
            } else {
                content = JSON.stringify(responseBody);
            }

            // Extract JSON from response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }

            // Fallback: try to parse entire response
            return JSON.parse(content);
        } catch (error) {
            this.logger.warn('Failed to parse structured response, returning raw content');
            return {
                summary: responseBody.content?.[0]?.text || 'Parse error',
                entities: [],
                keyPoints: [],
                sentiment: 'unknown',
            };
        }
    }
}
