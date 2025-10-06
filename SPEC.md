## Concept Specification — AnchorAssist for AnchoredContext (A3)

### Original Concept (AnchoredContext) — unchanged

- State:
  - `AnchorRef = Section{name, index?} | Figure{id} | Lines{page, lineStart, lineEnd}`
- Actions:
  - `attachAnchor(postId, anchorRef)` — requires valid anchor fields; effect associates anchor with post
- Operational Principle:
  - Users can manually attach precise anchors to posts to ground discussion; no AI involvement required.

### AI-Augmented Concept (AnchorAssist)

- New LLM Action:
  - `inferAnchor(paperId, hintText, quote?) -> { anchor: AnchorRef, snippet: string, confidence: number }`
  - Requires: `paperId` exists; `hintText` non-empty
  - Effects: Returns a proposal; does not mutate state. Front-end asks user to accept/edit; manual path remains available.
- Added Operational Principle:
  - When a textual hint or quote is provided, the system may call an LLM to propose a precise `AnchorRef` that the user can accept or edit before posting. Low-confidence results require explicit confirmation.

### Validators (in code)

In practice, LLM proposals can fail in predictable ways that would harm user trust if left unchecked. First, when returning `Lines`, the model may pick page/line bounds that are outside the known document limits or invert the span; we enforce page and line ranges as well as `start ≤ end`. Second, the kind of anchor can drift from the user’s intent: hints that explicitly mention a figure or a section should map to `Figure` or `Section`, and the presence of an exact quote should force a `Lines` anchor; we flag any mismatch to avoid misleading anchors. Third, even when the structure is valid, the model’s self-reported certainty varies; low-confidence proposals are still useful but must be surfaced for user confirmation, so we mark them as `needsConfirmation` below a threshold.

1) Out-of-range `Lines` page/line spans (page within 1..N; lines within 1..linesPerPage; start ≤ end).  
2) Mismatched kind vs hint/quote (mentions “Figure” → kind must be Figure; mentions “Section” → Section; quote → Lines).  
3) Low confidence (< 0.5) marks `needsConfirmation`.

### Prompt Variants

- `json` — strict JSON schema output only.  
- `retrieve-then-localize` — reason with TOC/figures first; then output JSON.  
- `json-negative` — strict schema plus negative list (“do not hallucinate”).

### Test Scenarios

- T1: “Fig. 3b ablations” → expect `Figure: 3b`.  
- T2: Quoted sentence → expect `Lines` span.  
- T3: “Section 4: Limitations” → expect `Section` canonicalization.

### Files

- `anchor-assist.ts` — Types, prompt builder, validators.  
- `anchor-assist-tests.ts` — Runs 3 scenarios × 3 variants and prints readable outputs.  
- `gemini-llm.ts` — Gemini wrapper (cheap model, capped output tokens).  
- `README.md` — Run instructions, file map.


