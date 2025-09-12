export type Window = {
  index: number
  from: string
  to: string
  text: string
}

export function hhmmssToSeconds(s: string): number {
  const parts = s.split(":").map(Number)
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

export function secondsToHHMMSS(sec: number): string {
  const hours = Math.floor(sec / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  const seconds = sec % 60
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
}

export function splitTranscriptIntoWindows(raw: string, windowMinutes = 20): Window[] {
  // 1) Normalize line endings and trim
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  const lines = normalized.split("\n")

  // 2) Find first timestamp line and ignore header
  const timestampRegex = /^\d{2}:\d{2}:\d{2}\s*$/
  let firstTimestampIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (timestampRegex.test(lines[i])) {
      firstTimestampIndex = i
      break
    }
  }

  if (firstTimestampIndex === -1) {
    return [] // No timestamps found
  }

  // Process lines from first timestamp onwards
  const relevantLines = lines.slice(firstTimestampIndex)

  // 3) Parse timestamps and build content
  const windowDurationSeconds = windowMinutes * 60
  const windows: Window[] = []
  let currentWindowIndex = 0
  let currentTimestamp = 0

  // Group lines by their window
  const windowContents: { [key: number]: string[] } = {}

  for (const line of relevantLines) {
    if (timestampRegex.test(line)) {
      // This is a timestamp line
      currentTimestamp = hhmmssToSeconds(line.trim())
      currentWindowIndex = Math.floor(currentTimestamp / windowDurationSeconds)
    } else {
      // This is content - add to current window
      if (!windowContents[currentWindowIndex]) {
        windowContents[currentWindowIndex] = []
      }
      windowContents[currentWindowIndex].push(line)
    }
  }

  // 4) Build windows from collected content
  for (const [windowIndexStr, lines] of Object.entries(windowContents)) {
    const windowIndex = Number.parseInt(windowIndexStr)

    // 5) & 6) Remove empty lines and collapse multiple blanks
    const processedLines: string[] = []
    let lastWasEmpty = false

    for (const line of lines) {
      const isEmpty = line.trim() === ""
      if (isEmpty) {
        if (!lastWasEmpty) {
          processedLines.push("")
        }
        lastWasEmpty = true
      } else {
        processedLines.push(line)
        lastWasEmpty = false
      }
    }

    // 7) Join and trim
    const text = processedLines.join("\n").trim()

    // 8) Omit windows with no content
    if (text.length > 0) {
      const fromSeconds = windowIndex * windowDurationSeconds
      const toSeconds = fromSeconds + windowDurationSeconds - 1

      windows.push({
        index: windowIndex,
        from: secondsToHHMMSS(fromSeconds),
        to: secondsToHHMMSS(toSeconds),
        text,
      })
    }
  }

  return windows.sort((a, b) => a.index - b.index)
}

// Sample for unit testing
const SAMPLE = `Private Class: Juan Ortega - Transcript
00:00:00

Simon Sanchez: It worked, right?
Juan Alberto Ortega Riveros: Yeah. Yeah. Private.

00:01:00
Simon Sanchez: Try to choose classes that are one-on-one; it's easier to parse.
Juan Alberto Ortega Riveros: Mhm.`

export function __test_parse() {
  return splitTranscriptIntoWindows(SAMPLE, 20)
}
