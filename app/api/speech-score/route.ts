// app/api/speech-score/route.ts
import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 60

// ==== Request / Response types (client contract) ====

interface SpeechScoreRequest {
  expectedText: string
  audio: {
    // LC formats (mapped to audio_format):
    mime:
      | "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/m4a"
      | "audio/webm" | "audio/mp4" | "audio/aac"
    base64: string
    durationMs: number // client must cap at 10_000
  }
  accent?: string      // e.g., "en-us", "us", "en-gb", "gb", "au"…
  userId?: string      // optional; forwarded as x-user-id
}

type ScoreLabel = "poor" | "fair" | "good" | "very-good" | "excellent"

interface SpeechScoreResponse {
  ok: boolean
  data?: {
    provider: "language-confidence"
    accent: string
    overall: { score: number; label: ScoreLabel } // 0–100
    // Arbitrary sub-scores normalized to 0–100 (keys like pronunciation, fluency, completeness, pte, ielts…)
    details: Record<string, number>
    // Optional English proficiency labels the vendor returns (e.g., CEFR C2)
    englishProficiency?: { cefr?: string }
    // Per-word scores (0–100) with optional timings and phonemes (IPA + score)
    words: Array<{
      text: string
      score: number
      startMs?: number
      endMs?: number
      phonemes?: Array<{ ipa: string; score: number }>
    }>
    // Weakest phonemes if present
    lowestPhonemes?: Array<{ phoneme: string; score?: number }>
    // Echo of expected text from vendor (if provided)
    expectedText?: string
    // Timings
    timings: { processingMs: number }
    // Vendor warnings passthrough (if any)
    warnings?: Record<string, unknown>
  }
  code?: string
  message?: string
}

// ==== Helpers ====

function label(score: number): ScoreLabel {
  if (score < 40) return "poor"
  if (score < 60) return "fair"
  if (score < 75) return "good"
  if (score < 90) return "very-good"
  return "excellent"
}

function to0100(x: unknown): number {
  if (typeof x !== "number" || Number.isNaN(x)) return 0
  // LC usually returns 0–100; if 0–1 sneaks in, normalize.
  return x <= 1 ? Math.round(Math.min(1, Math.max(0, x)) * 100) : Math.round(Math.min(100, Math.max(0, x)))
}

function mapMimeToFormat(m: string): string | null {
  // LC accepts: wav, mp3, ogg, m4a, webm, mp4, aac
  switch (m) {
    case "audio/wav": return "wav"
    case "audio/mpeg": return "mp3"
    case "audio/ogg": return "ogg"
    case "audio/m4a": return "m4a"
    case "audio/webm": return "webm"
    case "audio/mp4": return "mp4"
    case "audio/aac": return "aac"
    default: return null
  }
}

// Normalize accent inputs to LC's path param (e.g., "en-us" → "us")
function normalizeAccent(a?: string): string {
  if (!a) return "us"
  const s = a.toLowerCase()
  if (s === "en-us") return "us"
  if (s === "en-gb" || s === "gb-en" || s === "uk" || s === "en-uk") return "gb"
  if (s === "en-au" || s === "au-en") return "au"
  // If user already passes "us", "gb", "au", just return
  return s
}

function cut(s: string, max = 2000) {
  return typeof s === "string" && s.length > max ? s.slice(0, max) + "…[truncated]" : s
}

// Scale helper for IELTS (1–9) and PTE (0–90) to 0–100 for UI bars
const scaleIELTS = (x: number) => Math.round((Math.max(0, Math.min(9, x)) / 9) * 100)
const scalePTE = (x: number) => Math.round((Math.max(0, Math.min(90, x)) / 90) * 100)

// ==== Route ====

export async function POST(req: NextRequest): Promise<NextResponse<SpeechScoreResponse>> {
  const t0 = Date.now()
  try {
    const body = (await req.json()) as SpeechScoreRequest

    // Basic validation
    if (!body?.expectedText || typeof body.expectedText !== "string" || body.expectedText.length > 500) {
      return NextResponse.json(
        { ok: false, code: "invalid_input", message: "expectedText (1–500 chars) required" },
        { status: 400 },
      )
    }
    if (!body?.audio?.base64 || !body.audio.mime || typeof body.audio.durationMs !== "number") {
      return NextResponse.json(
        { ok: false, code: "invalid_input", message: "audio {mime, base64, durationMs} required" },
        { status: 400 },
      )
    }
    if (body.audio.durationMs > 10_000) {
      return NextResponse.json({ ok: false, code: "audio_too_long", message: "Max 10 seconds" }, { status: 400 })
    }

    const audio_format = mapMimeToFormat(body.audio.mime)
    if (!audio_format) {
      return NextResponse.json({ ok: false, code: "invalid_input", message: "Unsupported audio MIME" }, { status: 400 })
    }

    const apiKey = process.env.LC_API_KEY || process.env.LANGUAGE_CONFIDENCE_API_KEY
    if (!apiKey) {
      console.error("[speech-score] Missing LC_API_KEY")
      return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 })
    }

    const accent = normalizeAccent(body.accent)
    const url = `https://apis.languageconfidence.ai/pronunciation/${encodeURIComponent(accent)}`

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": apiKey,
    }
    const fwdUserId = body.userId || req.headers.get("x-user-id")
    if (fwdUserId) headers["x-user-id"] = fwdUserId

    const vendorRes = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        audio_base64: body.audio.base64,
        audio_format,
        expected_text: body.expectedText,
        user_metadata: {}, // optional
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!vendorRes.ok) {
      const txt = await vendorRes.text().catch(() => "")
      console.error("[speech-score] Vendor error", vendorRes.status, cut(txt))
      return NextResponse.json(
        { ok: false, code: "vendor_error", message: `Vendor HTTP ${vendorRes.status}` },
        { status: 502 },
      )
    }

    const v: any = await vendorRes.json().catch(() => ({}))

    // ----- Map LC → our response -----

    // overall
    const overallScore = to0100(v?.overall_score ?? v?.overallScore ?? v?.score)

    // details + englishProficiency (exact LC schema provided)
    const details: Record<string, number> = {}
    const englishProficiency: { cefr?: string } = {}

    if (v?.english_proficiency_scores && typeof v.english_proficiency_scores === "object") {
      const eps = v.english_proficiency_scores

      // CEFR string label (A1–C2)
      const cefrPred = eps?.mock_cefr?.prediction
      if (typeof cefrPred === "string" && cefrPred) {
        englishProficiency.cefr = cefrPred
      }

      // PTE (0–90) → scale 0–100
      const ptePred = eps?.mock_pte?.prediction
      if (typeof ptePred === "number") {
        details.pte = scalePTE(ptePred)
      }

      // IELTS (1–9) → scale 0–100
      const ieltsPred = eps?.mock_ielts?.prediction
      if (typeof ieltsPred === "number") {
        details.ielts = scaleIELTS(ieltsPred)
      }
    }

    // words (word_text, word_score, phonemes[])
    const words: SpeechScoreResponse["data"]["words"] = []
    if (Array.isArray(v?.words)) {
      for (const w of v.words) {
        const text = (w?.word_text ?? w?.text ?? w?.word ?? "").toString()
        const score = typeof w?.word_score === "number" ? to0100(w.word_score)
                    : typeof w?.score === "number" ? to0100(w.score) : 0

        const out: SpeechScoreResponse["data"]["words"][number] = { text, score }

        if (Array.isArray(w?.phonemes)) {
          const phonemes: Array<{ ipa: string; score: number }> = []
          for (const p of w.phonemes) {
            const ipa = (p?.ipa_label ?? p?.ipa ?? p?.symbol ?? "").toString()
            const ps  = typeof p?.phoneme_score === "number" ? to0100(p.phoneme_score)
                     : typeof p?.score === "number" ? to0100(p.score) : 0
            if (ipa) phonemes.push({ ipa, score: ps })
          }
          if (phonemes.length) out.phonemes = phonemes
        }

        words.push(out)
      }
    }

    // lowest_scoring_phonemes
    let lowestPhonemes: Array<{ phoneme: string; score?: number }> | undefined
    if (Array.isArray(v?.lowest_scoring_phonemes)) {
      lowestPhonemes = v.lowest_scoring_phonemes.map((p: any) => ({
        phoneme: (p?.ipa_label ?? p?.phoneme ?? p?.symbol ?? "").toString(),
        score: typeof p?.phoneme_score === "number" ? to0100(p.phoneme_score) : undefined,
      }))
    }

    const res: SpeechScoreResponse = {
      ok: true,
      data: {
        provider: "language-confidence",
        accent,
        overall: { score: overallScore, label: label(overallScore) },
        details,
        englishProficiency: Object.keys(englishProficiency).length ? englishProficiency : undefined,
        words,
        lowestPhonemes,
        expectedText: typeof v?.expected_text === "string" ? v.expected_text : undefined,
        timings: { processingMs: Date.now() - t0 },
        warnings: typeof v?.warnings === "object" ? v.warnings : undefined,
      },
    }

    return NextResponse.json(res)
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return NextResponse.json({ ok: false, code: "vendor_error", message: "Request timeout" }, { status: 504 })
    }
    console.error("[speech-score] Unhandled error", err?.name || "Error", err?.message || err)
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 })
  }
}
