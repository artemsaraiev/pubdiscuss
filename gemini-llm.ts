/**
 * LLM Integration for DayPlanner
 * 
 * Handles the requestAssignmentsFromLLM functionality using Google's Gemini API.
 * The LLM prompt is hardwired with user preferences and doesn't take external hints.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Configuration for API access
 */
export interface Config {
    apiKey: string;
}

export class GeminiLLM {
    private apiKey: string;

    constructor(config: Config) {
        this.apiKey = config.apiKey;
    }

    async executeLLM (prompt: string): Promise<string> {
        const maxOutputTokens = 300;
        const timeoutMs = 15000;
        const maxAttempts = 2;

        const genAI = new GoogleGenerativeAI(this.apiKey);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-lite",
            generationConfig: {
                maxOutputTokens,
            }
        });

        let lastErr: unknown = undefined;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const text = await this.withTimeout(async () => {
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    return response.text();
                }, timeoutMs);
                return text;
            } catch (error) {
                lastErr = error;
                const delay = attempt * 500;
                await new Promise(r => setTimeout(r, delay));
            }
        }
        console.error('FAIL Error calling Gemini API:', (lastErr as Error)?.message || lastErr);
        throw lastErr instanceof Error ? lastErr : new Error('Gemini API call failed');
    }

    private async withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
        let timer: NodeJS.Timeout;
        return await Promise.race([
            fn(),
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`LLM call timed out after ${ms}ms`)), ms);
            })
        ]).finally(() => {
            // @ts-ignore timer may be undefined if fn resolved first
            if (timer) clearTimeout(timer);
        });
    }
}
