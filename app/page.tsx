"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import { splitTranscriptIntoWindows, type Window } from "../lib/parseTranscript"

interface Sentence {
  timestamp: string | null
  original: string
  level_detected?: "A2" | "B1" | "B2" | "C1"
  selection_reason: {
    type: "grammar" | "natural" | "concise"
    note: string
  }
  alternatives: Array<{
    level: "B2" | "C1" | "C2"
    phrase: string
    explanation: string
  }>
}

interface Vocab {
  word: string
  IPA: string
  definition: string
}

interface WindowJob {
  index: number
  status: "pending" | "ok" | "error"
  errorCode?: string
}

interface Progress {
  total: number
  done: number
  failed: number
}

interface Results {
  sentences: Sentence[]
  vocabulary: Vocab[]
}

interface Favorites {
  sentenceKeys: Set<string>
  vocabKeys: Set<string>
}

interface SpeechScore {
  score: number
  label: "poor" | "fair" | "good" | "very-good" | "excellent"
  details?: {
    fluency: number
    pronunciation: number
    completeness: number
  }
  words?: Array<{
    text: string
    score: number
  }>
}

interface RecordingState {
  isRecording: boolean
  isProcessing: boolean
  score: SpeechScore | null
  error: string | null
  audioUrl: string | null
}

type SpeechAudioPayload = {
  mime: "audio/webm" | "audio/mpeg" | "audio/wav" | "audio/ogg" | "audio/m4a" | "audio/mp4" | "audio/aac"
  base64: string
  durationMs: number
}

type SpeechScoreData = {
  provider: "language-confidence"
  accent: "us"
  expectedText: string
  overall: {
    score: number
    label: "poor" | "fair" | "good" | "very-good" | "excellent"
  }
  details: Partial<{
    pronunciation: number
    fluency: number
    completeness: number
  }>
  words?: Array<{ text: string; score: number; startMs?: number; endMs?: number }>
  lowestPhonemes?: Array<{ phoneme: string; score: number }>
  timings?: { processingMs: number }
  warnings?: Record<string, unknown>
}

interface PracticeQuiz {
  open: boolean
  mode: "alt" | "vocab" | null
  queue: string[]
  index: number
  current?: {
    key: string
    phrase: string
    meta?: {
      level?: "B2" | "C1" | "C2"
      reasonType?: "grammar" | "natural" | "concise"
      reasonNote?: string
      vocab?: { word: string; IPA?: string; definition?: string }
    }
  }
}

interface RecState {
  status: "idle" | "recording" | "uploading" | "scored" | "error"
  startedAt?: number
  durationMs?: number
  mime?: string
  errorCode?: "invalid_input" | "audio_too_long" | "vendor_error" | "server_error" | "timeout"
  result?: SpeechScoreData
}

/** Normalize MediaRecorder MIME types to canonical values accepted by the backend */
function canonicalizeMime(
  m: string,
): "audio/webm" | "audio/mpeg" | "audio/wav" | "audio/mp4" | "audio/aac" | "audio/ogg" | "audio/m4a" {
  const base = (m || "").split(";")[0].trim().toLowerCase()
  if (base === "audio/x-wav") return "audio/wav"
  if (base === "audio/x-m4a") return "audio/m4a"
  if (base === "audio/mp3") return "audio/mpeg"
  const allowed = ["audio/webm", "audio/mpeg", "audio/wav", "audio/mp4", "audio/aac", "audio/ogg", "audio/m4a"] as const
  return allowed.includes(base as any) ? (base as any) : "audio/webm"
}

export default function Home() {
  const [view, setView] = useState<"hero" | "analysis">("hero")
  const [showTranscriptHelp, setShowTranscriptHelp] = useState(false)
  const [heroAnimatingOut, setHeroAnimatingOut] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [parsedWindows, setParsedWindows] = useState<Window[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseSuccess, setParseSuccess] = useState<string | null>(null)
  const [showDebug, setShowDebug] = useState(false)

  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<Progress>({ total: 0, done: 0, failed: 0 })
  const [windowJobs, setWindowJobs] = useState<WindowJob[]>([])
  const [results, setResults] = useState<Results>({ sentences: [], vocabulary: [] })
  const [objectives, setObjectives] = useState("Focus on pronunciation")
  const [activeTab, setActiveTab] = useState<"sentences" | "vocabulary">("sentences")

  const [favorites, setFavorites] = useState<{
    sentences: Set<string>
    vocabulary: Set<string>
  }>({
    sentences: new Set(),
    vocabulary: new Set(),
  })

  const [copyFeedback, setCopyFeedback] = useState(false)

  const [practiceApi, setPracticeApi] = useState<{
    pending: boolean
    last?: SpeechScoreData
    error?: { code: "invalid_input" | "audio_too_long" | "vendor_error" | "server_error" | "timeout"; message?: string }
  }>({ pending: false })

  const [practiceQuiz, setPracticeQuiz] = useState<PracticeQuiz>({
    open: false,
    mode: null,
    queue: [],
    index: 0,
  })

  const [rec, setRec] = useState<RecState>({ status: "idle" })

  const [recordingStates, setRecordingStates] = useState<Map<string, RecordingState>>(new Map())
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)

  const quizMediaRecorderRef = useRef<MediaRecorder | null>(null)
  const quizAudioChunksRef = useRef<Blob[]>([])
  const quizRecordingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [quizRecordingTime, setQuizRecordingTime] = useState(0)

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    setShowDebug(urlParams.get("debug") === "1")
  }, [])

  useEffect(() => {
    try {
      const stored = localStorage.getItem("dillo_favorites")
      if (stored) {
        const parsed = JSON.parse(stored)
        setFavorites({
          sentences: new Set(parsed.sentences || []),
          vocabulary: new Set(parsed.vocabulary || []),
        })
      }
    } catch (error) {
      console.error("Failed to load favorites:", error)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        "dillo_favorites",
        JSON.stringify({
          sentences: Array.from(favorites.sentences),
          vocabulary: Array.from(favorites.vocabulary),
        }),
      )
    } catch (error) {
      console.error("Failed to save favorites:", error)
    }
  }, [favorites])

  const hasTimestamp = /(^|\n)\d{2}:\d{2}:\d{2}\s*(\n|$)/.test(transcript)
  const canAnalyze = hasTimestamp && transcript.trim().length >= 40 && !processing

  const getAltKey = (sentence: Sentence, alt: { level: string; phrase: string }): string => {
    return `${sentence.timestamp ?? "t0"}::${sentence.original}::${alt.level}::${alt.phrase}`
  }

  const getVocabKey = (word: string): string => {
    return `vocab::${word.toLowerCase()}`
  }

  const getSentenceKey = (sentence: Sentence): string => {
    return `${sentence.timestamp ?? "—"}|${sentence.original.slice(0, 120)}`
  }

  const getAlternativeKey = (sentenceIndex: number, altIndex: number): string => {
    return `${sentenceIndex}-${altIndex}`
  }

  function resolveAltByKey(key: string): {
    phrase: string
    meta: { level: "B2" | "C1" | "C2"; reasonType?: "grammar" | "natural" | "concise"; reasonNote?: string }
  } | null {
    const parts = key.split("::")
    if (parts.length !== 4) return null

    const [timestamp, original, level, phrase] = parts

    for (const sentence of results.sentences) {
      if ((sentence.timestamp ?? "t0") === timestamp && sentence.original === original) {
        for (const alt of sentence.alternatives) {
          if (alt.level === level && alt.phrase === phrase) {
            return {
              phrase: alt.phrase,
              meta: {
                level: alt.level as "B2" | "C1" | "C2",
                reasonType: sentence.selection_reason.type,
                reasonNote: sentence.selection_reason.note,
              },
            }
          }
        }
      }
    }
    return null
  }

  function resolveVocabByKey(
    key: string,
  ): { phrase: string; meta: { vocab: { word: string; IPA?: string; definition?: string } } } | null {
    if (!key.startsWith("vocab::")) return null

    const word = key.slice(7) // remove 'vocab::'

    for (const vocab of results.vocabulary) {
      if (vocab.word.toLowerCase() === word) {
        return {
          phrase: vocab.word,
          meta: {
            vocab: {
              word: vocab.word,
              IPA: vocab.IPA,
              definition: vocab.definition,
            },
          },
        }
      }
    }
    return null
  }

  const toggleSentenceFavorite = (sentence: Sentence) => {
    const key = getSentenceKey(sentence)
    setFavorites((prev) => {
      const newKeys = new Set(prev.sentences)
      if (newKeys.has(key)) newKeys.delete(key)
      else newKeys.add(key)
      return { ...prev, sentences: newKeys }
    })
  }

  const toggleVocabFavorite = (vocab: Vocab) => {
    const key = getVocabKey(vocab.word)
    setFavorites((prev) => {
      const newKeys = new Set(prev.vocabulary)
      if (newKeys.has(key)) newKeys.delete(key)
      else newKeys.add(key)
      return { ...prev, vocabulary: newKeys }
    })
  }

  const startQuiz = (mode: "alt" | "vocab", clickedKey: string) => {
    const queue: string[] = []
    let startIndex = 0

    if (mode === "alt") {
      results.sentences.forEach((sentence) => {
        sentence.alternatives.forEach((alt) => {
          const key = getAltKey(sentence, alt)
          queue.push(key)
          if (key === clickedKey) startIndex = queue.length - 1
        })
      })
    } else {
      results.vocabulary.forEach((vocab) => {
        const key = getVocabKey(vocab.word)
        queue.push(key)
        if (key === clickedKey) startIndex = queue.length - 1
      })
    }

    setPracticeQuiz({
      open: true,
      mode,
      queue,
      index: startIndex,
    })
    setRec({ status: "idle" })
  }

  const closeQuiz = () => {
    setPracticeQuiz({
      open: false,
      mode: null,
      queue: [],
      index: 0,
    })
    setRec({ status: "idle" })

    // Stop any ongoing recording
    if (quizMediaRecorderRef.current && quizMediaRecorderRef.current.state === "recording") {
      quizMediaRecorderRef.current.stop()
    }
    if (quizRecordingTimerRef.current) {
      clearInterval(quizRecordingTimerRef.current)
      let quizRecordingTimerRefCurrent = null
      quizRecordingTimerRefCurrent = null
    }
  }

  const navigateQuiz = (direction: "prev" | "next") => {
    setPracticeQuiz((prev) => {
      const newIndex = direction === "prev" ? prev.index - 1 : prev.index + 1
      if (newIndex < 0 || newIndex >= prev.queue.length) return prev
      return { ...prev, index: newIndex }
    })
    setRec({ status: "idle" })
  }

  useEffect(() => {
    if (
      practiceQuiz.open &&
      practiceQuiz.queue.length > 0 &&
      practiceQuiz.index >= 0 &&
      practiceQuiz.index < practiceQuiz.queue.length
    ) {
      const key = practiceQuiz.queue[practiceQuiz.index]
      let current: PracticeQuiz["current"] | undefined

      if (practiceQuiz.mode === "alt") {
        const resolved = resolveAltByKey(key)
        if (resolved) {
          current = { key, phrase: resolved.phrase, meta: resolved.meta }
        }
      } else if (practiceQuiz.mode === "vocab") {
        const resolved = resolveVocabByKey(key)
        if (resolved) {
          current = { key, phrase: resolved.phrase, meta: resolved.meta }
        }
      }

      setPracticeQuiz((prev) => ({ ...prev, current }))
    }
  }, [practiceQuiz.open, practiceQuiz.mode, practiceQuiz.queue, practiceQuiz.index, results])

  const startQuizRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      const mimeTypes = ["audio/webm", "audio/mpeg", "audio/wav"]
      let selectedMimeType = "audio/wav"
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType
          break
        }
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType })
      quizMediaRecorderRef.current = mediaRecorder
      quizAudioChunksRef.current = []

      setRec({
        status: "recording",
        startedAt: Date.now(),
        mime: selectedMimeType,
      })

      setQuizRecordingTime(0)
      quizRecordingTimerRef.current = setInterval(() => {
        setQuizRecordingTime((prev) => {
          if (prev >= 10000) {
            stopQuizRecording()
            return 10000
          }
          return prev + 100
        })
      }, 100)

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          quizAudioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (quizRecordingTimerRef.current) {
          clearInterval(quizRecordingTimerRef.current)
        }
      }

      mediaRecorder.start()

      // Auto-stop at 10 seconds
      setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          stopQuizRecording()
        }
      }, 10000)
    } catch (error) {
      console.error("Failed to start recording:", error)
      setRec({ status: "error", errorCode: "server_error" })
    }
  }

  const stopQuizRecording = async () => {
    if (!quizMediaRecorderRef.current || quizMediaRecorderRef.current.state !== "recording") return

    quizMediaRecorderRef.current.stop()

    if (quizRecordingTimerRef.current) {
      clearInterval(quizRecordingTimerRef.current)
    }

    setRec((prev) => ({
      ...prev,
      status: "uploading",
      durationMs: quizRecordingTime,
    }))

    // Wait for data to be available
    setTimeout(async () => {
      if (quizAudioChunksRef.current.length === 0) {
        setRec({ status: "error", errorCode: "invalid_input" })
        return
      }

      const audioBlob = new Blob(quizAudioChunksRef.current, {
        type: quizMediaRecorderRef.current?.mimeType || "audio/wav",
      })

      // Convert to base64 and score
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1]
        const sendMime = canonicalizeMime(audioBlob.type)
        await scoreQuizRecording(sendMime, base64, quizRecordingTime)
      }
      reader.readAsDataURL(audioBlob)
    }, 100)
  }

  const scoreQuizRecording = async (mimeType: string, base64: string, durationMs: number) => {
    if (!practiceQuiz.current) {
      setRec({ status: "error", errorCode: "server_error" })
      return
    }

    try {
      const response = await fetch("/api/speech-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedText: practiceQuiz.current.phrase,
          audio: {
            mime: mimeType,
            base64,
            durationMs: Math.min(durationMs, 10000),
          },
          accent: "us",
        }),
      })

      const data = await response.json()

      if (response.ok && data.ok) {
        setRec({
          status: "scored",
          durationMs,
          mime: mimeType,
          result: data.data,
        })
      } else {
        setRec({ status: "error", errorCode: "vendor_error" })
      }
    } catch (error) {
      console.error("Failed to score recording:", error)
      setRec({ status: "error", errorCode: "timeout" })
    }
  }

  const retryQuizRecording = () => {
    setRec({ status: "idle" })
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (practiceQuiz.open) {
        if (e.key === "Escape") {
          e.preventDefault()
          if (rec.status === "recording") {
            stopQuizRecording()
          } else {
            closeQuiz()
          }
        } else if (e.key === " ") {
          e.preventDefault()
          if (rec.status === "idle") startQuizRecording()
          else if (rec.status === "recording") stopQuizRecording()
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canAnalyze) {
        e.preventDefault()
        handleAnalyze()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [practiceQuiz.open, rec.status, canAnalyze, transcript, objectives])

  const copyVocabularyList = async () => {
    const text = results.vocabulary.map((v) => `${v.word} — ${v.IPA} — ${v.definition}`).join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  const handleGetStarted = () => {
    setHeroAnimatingOut(true)
    setTimeout(() => setView("analysis"), 240)
  }

  const handleReset = () => {
    setTranscript("")
    setParsedWindows([])
    setParseError(null)
    setParseSuccess(null)
    setProcessing(false)
    setProgress({ total: 0, done: 0, failed: 0 })
    setWindowJobs([])
    setResults({ sentences: [], vocabulary: [] })
    setFavorites({ sentenceKeys: new Set(), vocabKeys: new Set() })
    recordingStates.forEach((state) => {
      if (state.audioUrl) URL.revokeObjectURL(state.audioUrl)
    })
    setRecordingStates(new Map())
    setShowFavoritesOnly(false)
    setView("hero")
    setHeroAnimatingOut(false)
  }

  const handleAnalyze = async () => {
    if (!canAnalyze) return

    try {
      setParseError(null)
      setParseSuccess(null)

      const windows = splitTranscriptIntoWindows(transcript, 20)
      setParsedWindows(windows)

      setProcessing(true)
      setProgress({ total: windows.length, done: 0, failed: 0 })
      setWindowJobs(windows.map((_, i) => ({ index: i, status: "pending" })))
      setResults({ sentences: [], vocabulary: [] })

      const concurrencyLimit = 3
      const allSentences: Sentence[] = []
      const vocabBag: Vocab[] = []

      const processWindow = async (windowIndex: number) => {
        const window = windows[windowIndex]
        try {
          const response = await fetch("/api/analyze-window", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ windowText: window.text, objectives }),
          })
          const data = await response.json()
          if (response.ok && data.ok) {
            allSentences.push(...(data.data.sentences || []))
            vocabBag.push(...(data.data.vocabulary || []))
            setWindowJobs((prev) => prev.map((job) => (job.index === windowIndex ? { ...job, status: "ok" } : job)))
            setProgress((prev) => ({ ...prev, done: prev.done + 1 }))
          } else {
            const errorCode = data.code || "error"
            setWindowJobs((prev) =>
              prev.map((job) => (job.index === windowIndex ? { ...job, status: "error", errorCode } : job)),
            )
            setProgress((prev) => ({ ...prev, failed: prev.failed + 1 }))
          }
        } catch {
          setWindowJobs((prev) =>
            prev.map((job) =>
              job.index === windowIndex ? { ...job, status: "error", errorCode: "network_error" } : job,
            ),
          )
          setProgress((prev) => ({ ...prev, failed: prev.failed + 1 }))
        }
      }

      const promises: Promise<void>[] = []
      for (let i = 0; i < windows.length; i += concurrencyLimit) {
        const batch = windows.slice(i, i + concurrencyLimit)
        const batchPromises = batch.map((_, batchIndex) => processWindow(i + batchIndex))
        promises.push(...batchPromises)
        if (i + concurrencyLimit < windows.length) {
          await Promise.all(batchPromises)
        }
      }
      await Promise.all(promises)

      const seenWords = new Set<string>()
      const dedupVocab = vocabBag.filter((v) => {
        const key = v.word.toLowerCase()
        if (seenWords.has(key)) return false
        seenWords.add(key)
        return true
      })

      setResults({ sentences: allSentences, vocabulary: dedupVocab })

      if (allSentences.length > 0) setActiveTab("sentences")
      setProcessing(false)
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Failed to analyze transcript")
      setProcessing(false)
    }
  }

  useEffect(() => {
    return () => {
      recordingStates.forEach((state) => {
        if (state.audioUrl) URL.revokeObjectURL(state.audioUrl)
      })
    }
  }, [])

  const transcriptExample = `Private Class: Juan Ortega - Transcript
00:00:00

Simon Sanchez: It worked, right?
Juan Alberto Ortega Riveros: Yeah. Yeah. Private.
Simon Sanchez: After the meeting it should show up in the same folder I gave you access to.
Juan Alberto Ortega Riveros: Yeah.

00:01:00

Simon Sanchez: Try to choose classes that are one-on-one; it's easier to parse.
Juan Alberto Ortega Riveros: Mhm.
Simon Sanchez: You've seen the format, right?
Juan Alberto Ortega Riveros: Yeah. I saw it yesterday.`

  async function postSpeechScore(expectedText: string, audio: SpeechAudioPayload, signal?: AbortSignal) {
    const response = await fetch("/api/speech-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedText, audio, accent: "us" }),
      signal,
    })
    const data = await response.json()
    return data
  }

  async function scoreSpeech(expectedText: string, audio: SpeechAudioPayload) {
    setPracticeApi({ pending: true })
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 18000)
    try {
      const r = await postSpeechScore(expectedText, audio, ctrl.signal)
      if (r.ok) setPracticeApi({ pending: false, last: r.data })
      else setPracticeApi({ pending: false, error: { code: r.code as any, message: r.message } })
    } catch {
      setPracticeApi({ pending: false, error: { code: "timeout" } })
    } finally {
      clearTimeout(timer)
    }
  }

  const startRecording = (key: string) => {
    // Legacy inline recorder not used in new quiz modal (kept for compatibility)
    console.log(`startRecording(${key}) called`)
  }

  const stopRecording = (key: string) => {
    // Legacy inline recorder not used in new quiz modal (kept for compatibility)
    console.log(`stopRecording(${key}) called`)
  }

  if (view === "hero") {
    return (
      <main
        className={`min-h-screen flex flex-col items-center justify-center px-6 ${heroAnimatingOut ? "animate-out" : ""}`}
      >
        <div className="text-center space-y-8 max-w-2xl">
          <div className="uppercase tracking-wide text-sm font-medium text-[var(--muted-text)]">
            Built for English learners
          </div>

          <div className="flex justify-center">
            <Image
              src="/dillo-icon.png"
              alt="Dillo mascot"
              width={220}
              height={220}
              className="min-w-[180px] lg:min-w-[220px] rounded-3xl shadow-lg"
            />
          </div>

          <h1 className="font-brand text-6xl lg:text-7xl text-[var(--text)]">Dillo</h1>

          <p className="text-lg text-[var(--text)] max-w-prose">
            Your AI-native companion for English classes and partner meetings — focused on pronunciation.
          </p>

          <p className="text-[var(--muted-text)]">
            Paste a transcript and get targeted alternatives, IPA, and practice scores.
          </p>

          <div className="space-y-3">
            <button
              onClick={handleGetStarted}
              className="bg-[var(--accent)] text-[var(--accent-contrast)] px-7 py-3.5 rounded-2xl shadow-md hover:brightness-95 active:brightness-90 transition font-medium"
            >
              Get started
            </button>
            <div className="text-sm text-[var(--muted-text)]">/ɡɛt ˈstɑːrtɪd/</div>
          </div>
        </div>
      </main>
    )
  }

  const copyVocabularyToClipboard = async () => {
    const text = results.vocabulary.map((v) => `${v.word} — ${v.IPA} — ${v.definition}`).join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Analysis View */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-3">
              <Image src="/dillo-icon.png" alt="Dillo" width={48} height={48} className="rounded-xl" />
              <h1 className="font-brand text-3xl text-[var(--text)]">Dillo</h1>
            </div>
            <p className="text-[var(--muted-text)]">AI-native companion for English learners</p>
          </div>

          {/* Transcript Input */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label htmlFor="transcript" className="block text-sm font-medium text-[var(--text)]">
                Transcript
              </label>
              <button
                onClick={() => setShowTranscriptHelp(!showTranscriptHelp)}
                className="text-sm text-[var(accent)] hover:underline focus-visible:focus-ring"
              >
                Need help?
              </button>
            </div>

            {showTranscriptHelp && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
                <p className="font-medium text-blue-900 mb-2">Transcript format:</p>
                <div className="space-y-2 text-blue-800">
                  <p>• Include timestamps (HH:MM:SS format)</p>
                  <p>• Paste the full conversation or lesson</p>
                  <p>• At least 40 characters needed for analysis</p>
                </div>
              </div>
            )}

            <textarea
              id="transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={transcriptExample}
              className="w-full h-48 px-4 py-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
            />

            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <span className={hasTimestamp ? "text-green-600" : "text-gray-400"}>
                  {hasTimestamp ? "✓" : "○"} Timestamps detected
                </span>
                <span className={transcript.length >= 40 ? "text-green-600" : "text-gray-400"}>
                  {transcript.length >= 40 ? "✓" : "○"} Minimum length ({transcript.length}/40)
                </span>
              </div>
              <span className="text-[var(--muted-text)]">Cmd+Enter to analyze</span>
            </div>
          </div>

          {/* Objectives */}
          <div className="space-y-2">
            <label htmlFor="objectives" className="block text-sm font-medium text-[var(--text)]">
              Learning objectives
            </label>
            <input
              id="objectives"
              type="text"
              value={objectives}
              onChange={(e) => setObjectives(e.target.value)}
              placeholder="Focus on pronunciation, grammar, vocabulary..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
            />
          </div>

          {/* Analyze Button */}
          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className="w-full bg-[var(--accent)] text-[var(--accent-contrast)] py-3 px-6 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-95 active:brightness-90 transition focus-visible:focus-ring"
          >
            {processing ? "Analyzing..." : "Analyze transcript"}
          </button>

          {/* Progress */}
          {processing && (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span>Processing windows...</span>
                <span>
                  {progress.done + progress.failed}/{progress.total}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-[var(--accent)] h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${progress.total > 0 ? ((progress.done + progress.failed) / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              {progress.failed > 0 && (
                <p className="text-sm text-red-600">{progress.failed} windows failed to process</p>
              )}
            </div>
          )}

          {/* Parse Error */}
          {parseError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 font-medium">Analysis failed</p>
              <p className="text-red-700 text-sm mt-1">{parseError}</p>
            </div>
          )}

          {/* Parse Success */}
          {parseSuccess && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-green-800 font-medium">Analysis complete!</p>
              <p className="text-green-700 text-sm mt-1">{parseSuccess}</p>
            </div>
          )}

          {/* Results */}
          {(results.sentences.length > 0 || results.vocabulary.length > 0) && (
            <div className="space-y-6 mt-8">
              {/* Tab Navigation */}
              <div className="border-b border-gray-200">
                <nav className="flex space-x-8">
                  <button
                    onClick={() => setActiveTab("sentences")}
                    className={`py-2 px-1 border-b-2 font-medium text-sm focus-visible:focus-ring ${
                      activeTab === "sentences"
                        ? "border-[var(--accent)] text-[var(accent)] bg-[var(--accent)]/5"
                        : "border-transparent text-gray-600 hover:text-[var(--text)] hover:border-gray-300"
                    }`}
                  >
                    Sentences ({results.sentences.length})
                  </button>
                  <button
                    onClick={() => setActiveTab("vocabulary")}
                    className={`py-2 px-1 border-b-2 font-medium text-sm focus-visible:focus-ring ${
                      activeTab === "vocabulary"
                        ? "border-[var(--accent)] text-[var(accent)] bg-[var(--accent)]/5"
                        : "border-transparent text-gray-600 hover:text-[var(--text)] hover:border-gray-300"
                    }`}
                  >
                    Vocabulary ({results.vocabulary.length})
                  </button>
                </nav>
              </div>

              {/* Tab Content */}
              <div className="transition-all duration-200">
                {activeTab === "sentences" && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <p className="text-sm text-[var(--muted-text)]">
                        Practice clearer, more natural alternatives. Record and get instant feedback.
                      </p>
                      {favorites.sentences.size > 0 && (
                        <button
                          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                          className={`text-sm px-3 py-1.5 rounded-lg border focus-visible:focus-ring ${
                            showFavoritesOnly
                              ? "bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)]"
                              : "bg-white text-[var(--text)] border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          {showFavoritesOnly ? "Show all" : "Show favorites only"}
                        </button>
                      )}
                    </div>

                    {/* Favorites banner */}
                    {favorites.sentences.size > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <p className="text-amber-800 text-sm">
                          ⭐ {favorites.sentences.size} favorite{favorites.sentences.size !== 1 ? "s" : ""} saved
                        </p>
                      </div>
                    )}

                    <div className="space-y-6">
                      {results.sentences
                        .filter((sentence) => {
                          if (!showFavoritesOnly) return true
                          return favorites.sentences.has(getSentenceKey(sentence))
                        })
                        .map((sentence, sentenceIndex) => (
                          <div key={sentenceIndex} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
                            {/* Original sentence */}
                            <div className="space-y-2">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-mono text-[var(--muted-text)]">
                                      {sentence.timestamp || "—"}
                                    </span>
                                    {sentence.level_detected && (
                                      <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full">
                                        {sentence.level_detected}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[var(--text)] leading-relaxed">{sentence.original}</p>
                                </div>
                                <button
                                  onClick={() => toggleSentenceFavorite(sentence)}
                                  className={`ml-4 p-2 rounded-lg transition-colors focus-visible:focus-ring ${
                                    favorites.sentences.has(getSentenceKey(sentence))
                                      ? "text-amber-500 hover:text-amber-600"
                                      : "text-gray-400 hover:text-gray-600"
                                  }`}
                                  title={
                                    favorites.sentences.has(getSentenceKey(sentence))
                                      ? "Remove from favorites"
                                      : "Add to favorites"
                                  }
                                >
                                  ⭐
                                </button>
                              </div>

                              {/* Selection reason */}
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full capitalize">
                                  {sentence.selection_reason.type}
                                </span>
                                <span className="text-xs text-[var(--muted-text)]">
                                  {sentence.selection_reason.note}
                                </span>
                              </div>
                            </div>

                            {/* Alternatives */}
                            <div className="space-y-3">
                              <h4 className="text-sm font-medium text-[var(--text)]">Practice alternatives:</h4>
                              {sentence.alternatives.map((alt, altIndex) => {
                                const altKey = getAlternativeKey(sentenceIndex, altIndex)
                                const recordingState = recordingStates.get(altKey)
                                const quizKey = getAltKey(sentence, alt)

                                return (
                                  <div
                                    key={altIndex}
                                    className="bg-gray-50 rounded-lg p-4 space-y-3 border border-gray-100"
                                  >
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                          <span
                                            className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                              alt.level === "B2"
                                                ? "bg-green-100 text-green-800"
                                                : alt.level === "C1"
                                                  ? "bg-blue-100 text-blue-800"
                                                  : "bg-purple-100 text-purple-800"
                                            }`}
                                          >
                                            {alt.level}
                                          </span>
                                        </div>
                                        <p className="text-[var(--text)] font-medium mb-2">{alt.phrase}</p>
                                        <p className="text-sm text-[var(--muted-text)]">{alt.explanation}</p>
                                      </div>
                                      <div className="flex items-center justify-center gap-2 ml-4">
                                        {/* Removed star from subitems (alternatives) per request */}
                                        <button
                                          onClick={() => startQuiz("alt", quizKey)}
                                          className="p-2 text-[var(--accent)] hover:bg-[var(--accent)]/10 rounded-lg transition-colors focus-visible:focus-ring"
                                          title="Practice pronunciation"
                                        >
                                          🎤
                                        </button>
                                      </div>
                                    </div>

                                    {/* Legacy inline recorder block (optional/hidden unless state exists) */}
                                    {recordingState && (
                                      <div className="border-t border-gray-200 pt-3 space-y-3">
                                        {recordingState.isRecording && (
                                          <div className="flex items-center justify-between">
                                            <span className="text-sm text-red-600">Recording...</span>
                                            <span className="text-sm font-mono">
                                              {Math.floor(recordingTime / 1000)
                                                .toString()
                                                .padStart(2, "0")}
                                              :{((recordingTime % 1000) / 10).toFixed(0).padStart(2, "0")}
                                            </span>
                                            <button
                                              onClick={() => stopRecording(altKey)}
                                              className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 focus-visible:focus-ring"
                                            >
                                              Stop
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {activeTab === "vocabulary" && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <p className="text-sm text-[var(--muted-text)]">
                        Key vocabulary from your transcript with IPA pronunciation and definitions.
                      </p>
                      <div className="flex items-center gap-3">
                        {copyFeedback && <span className="text-sm text-green-600 animate-fade-in">Copied!</span>}
                        <button
                          onClick={copyVocabularyToClipboard}
                          className="text-sm px-3 py-1.5 rounded-lg border bg-white text-[var(--text)] border-gray-300 hover:bg-gray-50 focus-visible:focus-ring"
                        >
                          Copy all
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {results.vocabulary.map((vocab, index) => {
                        const vocabKey = getVocabKey(vocab.word)
                        const isFavorite = favorites.vocabulary.has(vocabKey)

                        return (
                          <div key={index} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h3 className="font-medium text-lg text-[var(--text)]">{vocab.word}</h3>
                                <p className="text-sm font-mono text-[var(--muted-text)] mt-1">{vocab.IPA}</p>
                                <p className="text-sm text-[var(--muted-text)] mt-2">{vocab.definition}</p>
                              </div>
                              <div className="flex items-center justify-center gap-2 ml-4">
                                <button
                                  onClick={() => toggleVocabFavorite(vocab)}
                                  className={`p-2 rounded-lg transition-colors focus-visible:focus-ring ${
                                    isFavorite
                                      ? "text-amber-500 hover:text-amber-600"
                                      : "text-gray-400 hover:text-gray-600"
                                  }`}
                                  title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                                >
                                  ⭐
                                </button>
                                <button
                                  onClick={() => startQuiz("vocab", vocabKey)}
                                  className="p-2 text-[var(--accent)] hover:bg-[var(--accent)]/10 rounded-lg transition-colors focus-visible:focus-ring"
                                  title="Practice pronunciation"
                                >
                                  🎤
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {practiceQuiz.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="border-b border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-[var(--text)]">Practice</h2>
                <button
                  onClick={closeQuiz}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg focus-visible:focus-ring"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-[var(--muted-text)] mb-3">Accent: American English (en-US)</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted-text)]">
                  Item {practiceQuiz.index + 1} of {practiceQuiz.queue.length}
                </span>
                <div className="w-32 bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-[var(--accent)] h-1.5 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${((practiceQuiz.index + 1) / practiceQuiz.queue.length) * 100}%`,
                      backgroundColor: '#2563eb'
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {practiceQuiz.current && (
                <>
                  {/* Prompt Panel */}
                  <div className="text-center space-y-4">
                    <div className="text-2xl font-medium text-[var(--text)]">{practiceQuiz.current.phrase}</div>

                    {/* Meta info */}
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      {practiceQuiz.current.meta?.level && (
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${
                            practiceQuiz.current.meta.level === "B2"
                              ? "bg-green-100 text-green-800"
                              : practiceQuiz.current.meta.level === "C1"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-purple-100 text-purple-800"
                          }`}
                        >
                          {practiceQuiz.current.meta.level}
                        </span>
                      )}
                      {practiceQuiz.current.meta?.reasonType && (
                        <span
                          className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full capitalize"
                          title={practiceQuiz.current.meta.reasonNote}
                        >
                          {practiceQuiz.current.meta.reasonType}
                        </span>
                      )}
                    </div>

                    {/* Vocab extra info */}
                    {practiceQuiz.current.meta?.vocab && (
                      <div className="space-y-2">
                        {practiceQuiz.current.meta.vocab.IPA && (
                          <div className="text-sm font-mono text-[var(--muted-text)]">
                            {practiceQuiz.current.meta.vocab.IPA}
                          </div>
                        )}
                        {practiceQuiz.current.meta.vocab.definition && (
                          <div className="text-sm text-[var(--muted-text)]">
                            {practiceQuiz.current.meta.vocab.definition}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions Row */}
                  <div className="flex items-center justify-between">
                    {/* Star only for vocabulary, not for sentence alternatives */}
                    {practiceQuiz.mode === "vocab" ? (
                      <button
                        onClick={() => {
                          const word = practiceQuiz.current!.key.slice(7) // 'vocab::'
                          for (const vocab of results.vocabulary) {
                            if (vocab.word.toLowerCase() === word) {
                              toggleVocabFavorite(vocab)
                              return
                            }
                          }
                        }}
                        className={`p-2 rounded-lg transition-colors focus-visible:focus-ring ${
                          favorites.vocabulary.has(practiceQuiz.current.key)
                            ? "text-amber-500 hover:text-amber-600"
                            : "text-gray-400 hover:text-gray-600"
                        }`}
                        title="Toggle favorite"
                      >
                        ⭐
                      </button>
                    ) : (
                      <div />
                    )}

                    <details className="relative">
                      <summary className="text-sm text-[var(--accent)] cursor-pointer hover:underline focus-visible:focus-ring">
                        Help
                      </summary>
                      <div className="absolute top-6 right-0 bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-sm text-[var(--muted-text)] w-64 z-10">
                        Record up to 10 seconds. Speak clearly. Then you'll see your score.
                      </div>
                    </details>
                  </div>

                  {/* Recorder/Results */}
                  <div className="text-center space-y-4">
                    {rec.status === "idle" && (
                      <div className="space-y-4 text-center">
                        <button
                          onClick={startQuizRecording}
                          className="w-24 h-24 bg-[var(--accent)] text-[var(--accent-contrast)] rounded-full flex items-center justify-center text-2xl hover:brightness-95 focus-visible:focus-ring transition-all mx-auto"
                        >
                          🎤
                        </button>
                        <div className="text-sm text-[var(--muted-text)]">Press Space or click to start</div>
                        <div className="text-xs text-[var(--muted-text)]">00:00 / 00:10</div>
                      </div>
                    )}

                    {rec.status === "recording" && (
                      <div className="space-y-4 text-center">
                        <button
                          onClick={stopQuizRecording}
                          className="w-24 h-24 bg-red-600 text-white rounded-full flex items-center justify-center text-2xl hover:bg-red-700 focus-visible:focus-ring transition-all animate-pulse mx-auto"
                        >
                          ⏹️
                        </button>
                        <div className="text-sm text-red-600 font-medium">
                          Recording... Press Space or click to stop
                        </div>
                        <div className="text-xs font-mono">
                          {Math.floor(quizRecordingTime / 1000)
                            .toString()
                            .padStart(2, "0")}
                          :
                          {Math.floor((quizRecordingTime % 1000) / 10)
                            .toString()
                            .padStart(2, "0")}{" "}
                          / 00:10
                        </div>
                      </div>
                    )}

                    {rec.status === "uploading" && (
                      <div className="space-y-4 text-center">
                        <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center text-2xl mx-auto">
                          <div className="animate-spin">⏳</div>
                        </div>
                        <div className="text-sm text-[var(--muted-text)]">Scoring...</div>
                      </div>
                    )}

                    {rec.status === "scored" && rec.result && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-center">
                          <span
                            className={`px-4 py-2 text-lg font-medium rounded-full ${
                              rec.result.overall.label === "excellent"
                                ? "bg-green-100 text-green-800"
                                : rec.result.overall.label === "very-good"
                                  ? "bg-blue-100 text-blue-800"
                                  : rec.result.overall.label === "good"
                                    ? "bg-yellow-100 text-yellow-800"
                                    : rec.result.overall.label === "fair"
                                      ? "bg-orange-100 text-orange-800"
                                      : "bg-red-100 text-red-800"
                            }`}
                          >
                            {rec.result.overall.score}/100 ({rec.result.overall.label})
                          </span>
                        </div>

                        {rec.result.details && Object.keys(rec.result.details).length > 0 && (
                          <div className="space-y-2">
                            {rec.result.details.pronunciation !== undefined && (
                              <div className="flex items-center gap-3">
                                <span className="text-sm w-20 text-right">Pronunciation</span>
                                <div className="flex-1 bg-gray-200 rounded-full h-2">
                                  <div
                                    className="bg-[var(--accent)] h-2 rounded-full"
                                    style={{ width: `${rec.result.details.pronunciation}%` }}
                                  />
                                </div>
                                <span className="text-sm w-8">{rec.result.details.pronunciation}</span>
                              </div>
                            )}
                            {rec.result.details.fluency !== undefined && (
                              <div className="flex items-center gap-3">
                                <span className="text-sm w-20 text-right">Fluency</span>
                                <div className="flex-1 bg-gray-200 rounded-full h-2">
                                  <div
                                    className="bg-[var(--accent)] h-2 rounded-full"
                                    style={{ width: `${rec.result.details.fluency}%` }}
                                  />
                                </div>
                                <span className="text-sm w-8">{rec.result.details.fluency}</span>
                              </div>
                            )}
                            {rec.result.details.completeness !== undefined && (
                              <div className="flex items-center gap-3">
                                <span className="text-sm w-20 text-right">Completeness</span>
                                <div className="flex-1 bg-gray-200 rounded-full h-2">
                                  <div
                                    className="bg-[var(--accent)] h-2 rounded-full"
                                    style={{ width: `${rec.result.details.completeness}%` }}
                                  />
                                </div>
                                <span className="text-sm w-8">{rec.result.details.completeness}</span>
                              </div>
                            )}
                          </div>
                        )}

                        <details className="text-left">
                          <summary className="cursor-pointer text-[var(accent)] hover:underline text-sm">
                            Breakdown
                          </summary>
                          <div className="mt-3 space-y-3">
                            {rec.result.words && rec.result.words.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium mb-2">Word scores:</h4>
                                <div className="space-y-1">
                                  {rec.result.words.map((word, i) => (
                                    <div key={i} className="flex justify-between text-sm">
                                      <span>{word.text}</span>
                                      <span className="font-medium">{word.score}/100</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {rec.result.lowestPhonemes && rec.result.lowestPhonemes.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium mb-2">Challenging sounds:</h4>
                                <div className="flex flex-wrap gap-2">
                                  {rec.result.lowestPhonemes.map((p, i) => (
                                    <span key={i} className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
                                      {p.phoneme} ({p.score})
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </details>
                      </div>
                    )}

                    {rec.status === "error" && (
                      <div className="space-y-4">
                        <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center text-2xl">
                          ❌
                        </div>
                        <div className="text-sm text-red-600">
                          {rec.errorCode === "invalid_input" || rec.errorCode === "audio_too_long"
                            ? "Please record up to 10 seconds and try again."
                            : rec.errorCode === "vendor_error"
                              ? "The scoring provider failed. Please try again."
                              : rec.errorCode === "server_error"
                                ? "Something went wrong. Try again."
                                : rec.errorCode === "timeout"
                                  ? "Network timed out. Please try again."
                                  : "An error occurred. Please try again."}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                    <button
                      onClick={() => navigateQuiz("prev")}
                      disabled={practiceQuiz.index === 0}
                      className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:focus-ring"
                    >
                      Previous
                    </button>

                    <div className="flex gap-2">
                      {(rec.status === "scored" || rec.status === "error") && (
                        <button
                          onClick={retryQuizRecording}
                          className="px-4 py-2 text-sm bg-[var(--accent)] text-[var(--accent-contrast)] rounded-lg hover:brightness-95 focus-visible:focus-ring"
                        >
                          Retry
                        </button>
                      )}
                      <button
                        onClick={closeQuiz}
                        className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 focus-visible:focus-ring"
                      >
                        Close
                      </button>
                    </div>

                    <button
                      onClick={() => navigateQuiz("next")}
                      disabled={practiceQuiz.index === practiceQuiz.queue.length - 1}
                      className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:focus-ring"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Debug Panel */}
      {showDebug && (
        <div className="fixed bottom-4 right-4 bg-[var(--surface)] border border-gray-300 rounded-lg p-4 max-w-sm shadow-lg">
          <h3 className="font-medium text-sm mb-2">Debug Info</h3>
          <div className="text-xs space-y-1 text-[var(--muted-text)]">
            <div>Windows: {parsedWindows.length}</div>
            <div>Sentences: {results.sentences.length}</div>
            <div>Vocabulary: {results.vocabulary.length}</div>
            <div>Favorites: {favorites.sentences.size + favorites.vocabulary.size}</div>
            <div>Quiz: {practiceQuiz.open ? "Open" : "Closed"}</div>
            <div>Recording: {rec.status}</div>
          </div>
        </div>
      )}
    </div>
  )
}
