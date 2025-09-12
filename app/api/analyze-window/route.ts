import { type NextRequest, NextResponse } from "next/server"
import { generateObject } from "ai"
import { openai } from "@ai-sdk/openai"
import { z } from "zod"
import { randomUUID } from "crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** =======================
 * Zod Schemas (flexibles)
 * ======================= */

// Alternatives are higher-level rewrites: B2 / C1 / C2
const AltSchema = z.object({
  level: z.enum(["B2", "C1", "C2"]),
  phrase: z.string().min(1).max(220),
  explanation: z.string().min(3).max(180),
})

// Why this sentence was chosen (impact category) + short note of the issue
const SelectionReasonSchema = z.object({
  type: z.enum(["grammar", "natural", "concise"]),
  note: z.string().min(3).max(240),
})

const SentenceSchema = z.object({
  timestamp: z.string().nullable(), // may be null
  original: z.string().min(1).max(400), // allow roomy originals
  level_detected: z.enum(["A2", "B1", "B2", "C1"]).optional(),
  selection_reason: SelectionReasonSchema, // required
  alternatives: z.array(AltSchema).min(1).max(3), // 1–3 higher-level alts (B2/C1/C2)
})

const VocabSchema = z.object({
  word: z.string().min(1).max(60),
  IPA: z.string().min(1).max(64),
  definition: z.string().min(3).max(160),
})

const WindowAnalysisSchema = z.object({
  schema_version: z.literal("dillo.window.v1"),
  sentences: z.array(SentenceSchema), // no hard cap (UI puede filtrar si quiere)
  vocabulary: z.array(VocabSchema), // no hard cap
  counts: z
    .object({
      sentence_count: z.number().int().min(0),
      vocab_count: z.number().int().min(0),
    })
    .optional(),
})

export type WindowAnalysis = z.infer<typeof WindowAnalysisSchema>

/** =======================
 * Helpers
 * ======================= */
function cut(str: string, maxLen = 3000) {
  return str && str.length > maxLen ? str.slice(0, maxLen) + "..." : str
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Preferred + fallbacks (ordered and current) */
const MODEL_PRIORITY = [
  "gpt-4.1", // robust structured JSON
  "gpt-4o-2024-08-06", // strong generalist
  "gpt-4o-mini", // cost-effective fallback
] as const

/** =======================
 * Route
 * ======================= */
export async function POST(request: NextRequest) {
  const reqId = randomUUID()
  const reqStart = Date.now()

  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error({
        level: "error",
        t: new Date().toISOString(),
        reqId,
        msg: "request_failure",
        status: 500,
        name: "MissingAPIKey",
        message: "OPENAI_API_KEY not configured",
      })
      return NextResponse.json({ ok: false, code: "missing_openai_key" }, { status: 500 })
    }

    const body = await request.json()
    const { windowText, objectives = "" } = body ?? {}

    console.log({
      level: "info",
      t: new Date().toISOString(),
      reqId,
      msg: "request_received",
      inputChars: typeof windowText === "string" ? windowText.length : 0,
      objectivesLen: typeof objectives === "string" ? objectives.length : 0,
    })

    if (typeof windowText !== "string" || windowText.trim() === "") {
      return NextResponse.json({ ok: false, code: "invalid_input" }, { status: 422 })
    }
    if (windowText.length > 50000) {
      return NextResponse.json({ ok: false, code: "input_too_large" }, { status: 413 })
    }

    const systemPrompt = `
Return ONLY a single JSON object that matches the provided schema. No prose, no markdown, no code fences.

Context & rules:
- Teacher is "Simon Sanchez".
- Consider teacher + students to select vocabulary (target B2–C2 range).
- Sentences must be student-only. If a window has few or no student lines, return fewer sentences (even 0).
- For EACH selected sentence:
  • Include selection_reason = { type: "grammar" | "natural" | "concise", note: short explanation }
    - grammar: explain the grammatical issue (tense, preposition, agreement, word order, etc.)
    - natural: explain why it sounds non-idiomatic or forced; what natives would say instead
    - concise: explain redundancy or verbosity; how to convey same meaning shorter
  • Provide 1–3 higher-level alternatives (levels among B2, C1, C2). Each has { level, phrase, explanation }.
    - Keep meaning; do not change intent.
    - Keep explanations short (≤ 160 chars).
- Do NOT include IPA for sentences (IPA only for vocabulary).
- Vocabulary: American English IPA; brief definitions (≤ 15 words); avoid named entities and ultra-rare forms; no duplicates.

Output schema (shape):
{
  "schema_version":"dillo.window.v1",
  "sentences":[
    {
      "timestamp":"HH:MM:SS | null",
      "original":"string",
      "level_detected":"A2|B1|B2|C1 (optional)",
      "selection_reason": { "type":"grammar|natural|concise", "note":"..." },
      "alternatives":[
        { "level":"B2|C1|C2", "phrase":"...", "explanation":"..." }
      ]
    }
  ],
  "vocabulary":[
    { "word":"...", "IPA":"...", "definition":"..." }
  ],
  "counts": { "sentence_count": number, "vocab_count": number } // optional; server will fill if missing
}

Mini example (for guidance only; do not copy text):
Input window:
"00:00:00
Simon Sanchez: How was your weekend?
Student: I was in the park and I do many activities."

Valid output sketch:
{
  "schema_version":"dillo.window.v1",
  "sentences":[
    {
      "timestamp":"00:00:05",
      "original":"I was in the park and I do many activities.",
      "level_detected":"B1",
      "selection_reason": { "type":"grammar", "note":"Wrong tense: 'do' → 'did'; preposition 'at the park'." },
      "alternatives":[
        { "level":"B2", "phrase":"I was at the park and did many activities.", "explanation":"Fixes tense and preposition." },
        { "level":"C1", "phrase":"I spent the weekend at the park and did a lot.", "explanation":"More native phrasing and flow." },
        { "level":"C2", "phrase":"I spent the weekend at the park, keeping busy.", "explanation":"Concise, idiomatic compression." }
      ]
    }
  ],
  "vocabulary":[
    { "word":"activity", "IPA":"ækˈtɪvɪti", "definition":"Something you do for a purpose or enjoyment." }
  ],
  "counts": { "sentence_count":1, "vocab_count":1 }
}
`.trim()

    let lastError: any = null

    for (const modelName of MODEL_PRIORITY) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const attemptStart = Date.now()
        console.log({
          level: "info",
          t: new Date().toISOString(),
          reqId,
          msg: "llm_attempt_start",
          model: modelName,
          attempt,
          inputChars: windowText.length,
        })

        try {
          const result = await generateObject({
            model: openai(modelName),
            // keep temperature undefined for best adherence
            schema: WindowAnalysisSchema,
            system: systemPrompt,
            prompt: JSON.stringify({
              window: windowText,
              objectives: typeof objectives === "string" ? objectives : "",
            }),
          })

          const raw = result.object
          const parsed = WindowAnalysisSchema.safeParse(raw)
          if (!parsed.success) {
            throw Object.assign(new Error("Schema validation failed"), {
              name: "ZodError",
              issues: parsed.error.issues?.slice?.(0, 8),
            })
          }

          const sentences = parsed.data.sentences ?? []
          const vocabulary = parsed.data.vocabulary ?? []
          const normalized: WindowAnalysis = {
            ...parsed.data,
            counts: {
              sentence_count: sentences.length,
              vocab_count: vocabulary.length,
            },
          }

          const elapsed = Date.now() - attemptStart
          console.log({
            level: "info",
            t: new Date().toISOString(),
            reqId,
            msg: "llm_attempt_success",
            model: modelName,
            attempt,
            elapsedMs: elapsed,
            sentenceCount: normalized.counts.sentence_count,
            vocabCount: normalized.counts.vocab_count,
          })

          const totalElapsed = Date.now() - reqStart
          console.log({
            level: "info",
            t: new Date().toISOString(),
            reqId,
            msg: "request_success",
            elapsedMs: totalElapsed,
          })

          return NextResponse.json({ ok: true, data: normalized })
        } catch (error: any) {
          lastError = error
          const elapsed = Date.now() - attemptStart
          console.error({
            level: "error",
            t: new Date().toISOString(),
            reqId,
            msg: "llm_attempt_error",
            model: modelName,
            attempt,
            elapsedMs: elapsed,
            status: error?.status || error?.statusCode,
            name: error?.name,
            message: error?.message,
            issues: error?.issues,
            responseBody: error?.responseBody ? cut(error.responseBody) : undefined,
          })

          const retryable = error?.status === 429 || (error?.status >= 500 && error?.status < 600)
          if (retryable && attempt === 1) {
            await sleep(800 + Math.random() * 700)
            continue // retry same model once
          }
          break // try next model
        }
      }
    }

    console.error({
      level: "error",
      t: new Date().toISOString(),
      reqId,
      msg: "request_failure",
      status: 502,
      name: "AllModelsFailed",
      message: "All models failed after retries",
    })

    return NextResponse.json({ ok: false, code: "bad_model_output" }, { status: 502 })
  } catch (error: any) {
    console.error({
      level: "error",
      t: new Date().toISOString(),
      reqId,
      msg: "request_failure",
      status: 500,
      name: error?.name,
      message: error?.message,
    })
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 })
  }
}
