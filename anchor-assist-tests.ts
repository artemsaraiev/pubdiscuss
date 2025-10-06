/**
 * AnchorAssist Test Cases (3 scenarios x 3 prompt variants)
 */

import { GeminiLLM, Config } from './gemini-llm';
import { AnchorAssist, PaperMeta, formatAnchor, PromptVariant } from './anchor-assist';

function loadConfig(): Config {
    try {
        const config = require('../config.json');
        return config;
    } catch (error) {
        console.error('FAIL Error loading config.json. Please ensure it exists with your API key.');
        console.error('Error details:', (error as Error).message);
        process.exit(1);
    }
}

// Minimal paper index for tests
const demoPaper: PaperMeta = {
    paperId: 'demo-001',
    title: 'Demo Paper: Regret Bounds and Ablations',
    sections: [
        { index: 1, name: 'Introduction' },
        { index: 2, name: 'Method' },
        { index: 3, name: 'Experiments' },
        { index: 4, name: 'Limitations' },
    ],
    figures: ['1', '2a', '2b', '3', '3a', '3b'],
    pages: 10,
    linesPerPage: 40,
};

async function runScenario(
    assist: AnchorAssist,
    name: string,
    hintText: string,
    quoteText: string | undefined,
    variant: PromptVariant
): Promise<void> {
    console.log(`\n--- Scenario: ${name} | Variant: ${variant} ---`);
    try {
        const result = await assist.inferAnchor({ paper: demoPaper, hintText, quoteText }, variant);
        console.log('Result:', formatAnchor(result));
        console.log('Snippet:', result.snippet);
    } catch (err) {
        console.error('Validator/Error:', (err as Error).message);
    }
}

export async function testAnchorAssistAll(): Promise<void> {
    const config = loadConfig();
    const llm = new GeminiLLM(config);
    const assist = new AnchorAssist(llm);

    const variants: PromptVariant[] = ['json', 'retrieve-then-localize', 'json-negative'];

    for (const variant of variants) {
        // T1: Fig. 3b ablations
        await runScenario(
            assist,
            'T1: Fig. 3b ablations',
            'Fig. 3b shows the ablations for the main model.',
            undefined,
            variant
        );

        // T2: Quoted sentence -> Lines
        await runScenario(
            assist,
            'T2: Quoted sentence',
            '“we minimize the regret with respect to the optimal policy”',
            'we minimize the regret with respect to the optimal policy',
            variant
        );

        // T3: Section 4 Limitations
        await runScenario(
            assist,
            'T3: Section 4 Limitations',
            'In Section 4 we discuss key limitations',
            undefined,
            variant
        );
    }
}

async function main(): Promise<void> {
    console.log('🧪 AnchorAssist Test Suite');
    try {
        await testAnchorAssistAll();
        console.log('\nOK AnchorAssist tests completed.');
    } catch (e) {
        console.error('FAIL Test run failed:', (e as Error).message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}


