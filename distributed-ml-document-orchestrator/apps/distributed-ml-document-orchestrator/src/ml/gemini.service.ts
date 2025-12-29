import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class GeminiService {
    private readonly logger = new Logger(GeminiService.name);
    private readonly genAI: GoogleGenerativeAI;
    private readonly model: any;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            this.logger.error('GEMINI_API_KEY is not defined in environment variables');
            throw new Error('GEMINI_API_KEY is missing');
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        // Initialize the Gemini 2.0 Flash Lite model for efficient and high-performance text analysis
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
    }

    async analyzeChunk(text: string, retries = 3, delay = 2000): Promise<any> {
        this.logger.log(`Analyzing page content with Gemini (Retries left: ${retries})...`);

        const prompt = `
            Analyze the following text from a single page of a document and provide a structured JSON response.
            The JSON should include:
            1. "summary": A brief summary of the page content.
            2. "entities": A list of key entities (people, organizations, locations, etc.) mentioned on this page.
            3. "keyPoints": A list of main points discussed on this page.
            4. "sentiment": The overall sentiment of the text.

            Text:
            ${text}

            Return ONLY the JSON object.
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const responseText = response.text();

            // Attempt to extract JSON from the response, handling cases where Gemini wraps output in markdown blocks
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }

            return JSON.parse(responseText);
        } catch (error) {
            if (error.message?.includes('429') && retries > 0) {
                this.logger.warn(`Rate limit hit, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.analyzeChunk(text, retries - 1, delay * 2);
            }
            this.logger.error(`Gemini analysis failed: ${error.message}`, error.stack);
            throw error;
        }
    }
}
