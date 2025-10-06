/**
 * AnchorAssist: LLM-augmented anchoring for PubDiscuss
 *
 * Converts fuzzy user hints (e.g., "see Fig. 3b" or a pasted quote) into a precise AnchorRef.
 * This augments the manual AnchoredContext by proposing a best-guess anchor that the user can
 * confirm or edit. Includes validators to catch common LLM mistakes.
 */

import { GeminiLLM } from './gemini-llm';

export type AnchorKind = 'Section' | 'Figure' | 'Lines';

export interface SectionMeta {
    index: number; // 1-based section number if applicable
    name: string;  // canonical section name, e.g., "Introduction"
}

export interface PaperMeta {
    paperId: string;
    title: string;
    sections: SectionMeta[]; // canonical list of sections
    figures: string[]; // identifiers like "1", "2a", "3b"
    pages: number; // total number of pages
    linesPerPage: number; // uniform line count per page (prototype simplification)
}

export interface AnchorRefSection {
    kind: 'Section';
    name: string; // canonicalized name
    index?: number; // optional numeric index if available
}

export interface AnchorRefFigure {
    kind: 'Figure';
    id: string; // e.g., "3b"
}

export interface AnchorRefLines {
    kind: 'Lines';
    page: number; // 1-based
    lineStart: number; // 1-based
    lineEnd: number; // inclusive
}

export type AnchorRef = AnchorRefSection | AnchorRefFigure | AnchorRefLines;

export interface InferAnchorInput {
    paper: PaperMeta;
    hintText: string; // e.g., "See Fig. 3b ablations" or a quoted sentence
    quoteText?: string; // optional exact quote snippet from the paper
}

export interface InferAnchorResult {
    anchor: AnchorRef;
    snippet: string; // short preview text (LLM-proposed)
    confidence: number; // 0..1
}

export interface ValidatedAnchorResult extends InferAnchorResult {
    needsConfirmation: boolean; // true if low confidence or other issues
}

export type PromptVariant = 'json' | 'retrieve-then-localize' | 'json-negative';

/**
 * AnchorAssist encapsulates LLM prompting and validation for inferring anchors.
 */
export class AnchorAssist {
    private llm: GeminiLLM;
    private confidenceThreshold = 0.5;

    constructor(llm: GeminiLLM) {
        this.llm = llm;
    }

    async inferAnchor(input: InferAnchorInput, variant: PromptVariant = 'json'): Promise<ValidatedAnchorResult> {
        const prompt = this.buildPrompt(input, variant);
        const raw = await this.llm.executeLLM(prompt);
        const parsed = this.parseLLMJson(raw);

        const result: InferAnchorResult = {
            anchor: parsed.anchor as AnchorRef,
            snippet: typeof parsed.snippet === 'string' ? parsed.snippet : '',
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
        };

        this.validateResult(input, result);

        const needsConfirmation = result.confidence < this.confidenceThreshold;
        return { ...result, needsConfirmation };
    }

    private buildPrompt(input: InferAnchorInput, variant: PromptVariant): string {
        const sectionList = input.paper.sections.map(s => `${s.index}. ${s.name}`).join('\n');
        const figureList = input.paper.figures.join(', ');

        const baseSchema = `
You must output STRICT JSON matching this schema (no extra keys). Output MUST be a single JSON object only — no markdown, no code fences, no commentary. The first character must be '{' and the last character must be '}'.
{
  "anchor": {
    "kind": "Section"|"Figure"|"Lines",
    // If kind=="Section":
    "name"?: string,
    "index"?: number,
    // If kind=="Figure":
    "id"?: string,
    // If kind=="Lines":
    "page"?: number,
    "lineStart"?: number,
    "lineEnd"?: number
  },
  "snippet": string,
  "confidence": number
}`.trim();

        const constraints = `
Constraints:
- Sections must be chosen from the provided canonical list.
- Figures must be chosen from the provided identifiers.
- For Lines, page is 1..${input.paper.pages}, lineStart>=1, lineEnd<=${input.paper.linesPerPage}, and lineStart<=lineEnd.
- If the hint explicitly mentions a figure, prefer kind=Figure; if it mentions a section, prefer kind=Section.
- If an exact quote is provided, you MUST return kind=Lines with a tight span around the quote. Do NOT return Section or Figure when a quote is provided.
`.trim();

        const hintBlock = `Hint: ${input.hintText}`;
        const quoteBlock = input.quoteText ? `Quote: ${input.quoteText}` : 'Quote: (none)';

        const paperBlock = `
Paper: ${input.paper.title}
Sections (canonical):\n${sectionList}
Figures: ${figureList}
Pages: ${input.paper.pages}, Lines per page: ${input.paper.linesPerPage}
`.trim();

        const negativeList = `Do NOT invent new sections or figures not present in the lists. If unsure, pick kind=Lines with a narrow span and lower confidence.`;

        switch (variant) {
            case 'json':
                return [
                    'Task: Infer a precise paper anchor from a user hint.',
                    paperBlock,
                    hintBlock,
                    quoteBlock,
                    constraints,
                    baseSchema,
                    'Return ONLY a single JSON object as specified. No prose, no markdown, no code fences.'
                ].join('\n\n');
            case 'retrieve-then-localize':
                return [
                    'Task: First, reason silently about likely location; then output ONLY JSON.',
                    'Step 1: Consider the table of contents and figure list to localize the hint.',
                    'Step 2: Choose the most precise AnchorRef (Section, Figure, or Lines).',
                    paperBlock,
                    hintBlock,
                    quoteBlock,
                    constraints,
                    baseSchema,
                    'Return ONLY a single JSON object as specified. No prose, no markdown, no code fences.'
                ].join('\n\n');
            case 'json-negative':
                return [
                    'Task: Infer a precise paper anchor from a user hint.',
                    paperBlock,
                    hintBlock,
                    quoteBlock,
                    constraints,
                    negativeList,
                    baseSchema,
                    'Return ONLY a single JSON object as specified. No prose, no markdown, no code fences.'
                ].join('\n\n');
        }
    }

    private parseLLMJson(raw: string): any {
        // Attempt to extract JSON from raw text. Prefer a code-fenced block or first {...} object
        const fenceMatch = raw.match(/```\s*json\s*([\s\S]*?)```/i);
        const text = fenceMatch ? fenceMatch[1] : raw;
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            const candidate = text.slice(firstBrace, lastBrace + 1);
            try {
                return JSON.parse(candidate);
            } catch (e) {
                // fallthrough
            }
        }
        // As a last resort, throw for invalid JSON
        throw new Error('LLM output is not valid JSON conforming to schema.');
    }

    private validateResult(input: InferAnchorInput, result: InferAnchorResult): void {
        const issues: string[] = [];

        // Validator 1: Out-of-range lines
        if (result.anchor.kind === 'Lines') {
            const a = result.anchor;
            if (!Number.isInteger(a.page) || a.page < 1 || a.page > input.paper.pages) {
                issues.push(`Lines: page ${a.page} out of range 1..${input.paper.pages}.`);
            }
            if (!Number.isInteger(a.lineStart) || a.lineStart < 1) {
                issues.push('Lines: lineStart must be >= 1.');
            }
            if (!Number.isInteger(a.lineEnd) || a.lineEnd > input.paper.linesPerPage) {
                issues.push(`Lines: lineEnd must be <= ${input.paper.linesPerPage}.`);
            }
            if (a.lineStart > a.lineEnd) {
                issues.push('Lines: lineStart must be <= lineEnd.');
            }
        }

        // Validator 2: Mismatched kind vs hint
        const lowerHint = input.hintText.toLowerCase();
        const mentionsFigure = /\bfig(ure)?\b/.test(lowerHint);
        const mentionsSection = /\bsec(tion)?\b/.test(lowerHint);
        if (mentionsFigure && result.anchor.kind !== 'Figure') {
            issues.push('Kind mismatch: hint suggests Figure, but result is not Figure.');
        }
        if (mentionsSection && result.anchor.kind !== 'Section') {
            issues.push('Kind mismatch: hint suggests Section, but result is not Section.');
        }
        if (input.quoteText && result.anchor.kind !== 'Lines') {
            issues.push('Kind mismatch: quote provided, prefer Lines anchor.');
        }

        // Validator 3: Low confidence
        if (result.confidence < this.confidenceThreshold) {
            issues.push(`Low confidence: ${result.confidence.toFixed(2)} < ${this.confidenceThreshold}.`);
        }

        // Cross-check for canonical section and figure identity (no hallucination)
        if (result.anchor.kind === 'Section') {
            const names = input.paper.sections.map(s => s.name.toLowerCase());
            if (result.anchor.name && !names.includes(result.anchor.name.toLowerCase())) {
                issues.push(`Unknown section name: ${result.anchor.name}.`);
            }
            if (typeof result.anchor.index === 'number') {
                const indices = input.paper.sections.map(s => s.index);
                if (!indices.includes(result.anchor.index)) {
                    issues.push(`Unknown section index: ${result.anchor.index}.`);
                }
            }
        }
        if (result.anchor.kind === 'Figure') {
            const ids = new Set(input.paper.figures.map(f => f.toLowerCase()));
            if (!ids.has(result.anchor.id.toLowerCase())) {
                issues.push(`Unknown figure id: ${result.anchor.id}.`);
            }
        }

        if (issues.length > 0) {
            throw new Error(`AnchorAssist validation failed:\n- ${issues.join('\n- ')}`);
        }
    }
}

// Pretty-printer for console output
export function formatAnchor(result: ValidatedAnchorResult): string {
    const { anchor, confidence, needsConfirmation } = result;
    const base = anchor.kind === 'Section'
        ? `Section: ${anchor.name}${typeof anchor.index === 'number' ? ` (#${anchor.index})` : ''}`
        : anchor.kind === 'Figure'
            ? `Figure: ${anchor.id}`
            : `Lines: p${anchor.page} ${anchor.lineStart}-${anchor.lineEnd}`;
    return `${base} | conf=${confidence.toFixed(2)}${needsConfirmation ? ' (needs confirmation)' : ''}`;
}


