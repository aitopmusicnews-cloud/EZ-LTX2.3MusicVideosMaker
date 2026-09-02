export type ParsedVisionShot = {
  label: string;
  start: number;
  end: number;
  rawText: string;
  visualDirection: string;
  cameraDirection: string;
  audioCue: string;
  onScreenText: string;
};

export type ParsedDirectorVision =
  | { mode: "general"; rawText: string }
  | { mode: "structured"; rawText: string; shots: ParsedVisionShot[] };

const RANGE = /(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/g;
const SHOT_PREFIX = /^\s*Shot\s+(\d+)\s*:\s*/i;

export function parseTimecode(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || seconds < 0 || seconds >= 60) return null;
  return minutes * 60 + seconds;
}

function extractLabeledLine(body: string, labels: RegExp[]): string {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    for (const label of labels) {
      const match = label.exec(line);
      if (match?.[1]) return match[1].trim();
    }
  }
  return "";
}

export function parseDirectorVision(value: string): ParsedDirectorVision {
  const rawText = value.trim();
  const matches = [...rawText.matchAll(RANGE)];
  const hasShotLabel = /\bShot\s+\d+\s*:/i.test(rawText);
  const structured = matches.length >= 2 || (matches.length === 1 && hasShotLabel);
  if (!structured) return { mode: "general", rawText };

  const shots: ParsedVisionShot[] = matches.flatMap((match, index) => {
    const start = parseTimecode(match[1]!);
    const end = parseTimecode(match[2]!);
    if (start === null || end === null || end <= start) return [];

    const chunkStart = (match.index ?? 0) + match[0].length;
    const chunkEnd = matches[index + 1]?.index ?? rawText.length;
    const rawChunk = rawText.slice(chunkStart, chunkEnd).trim();
    const prefixMatch = SHOT_PREFIX.exec(rawChunk);
    const hasLineBreak = /[\r\n]/.test(rawChunk);

    // Rich clipboard tables often paste a whole row as one long line. In that
    // form we keep the complete row as direction and use a simple Shot N label
    // so none of the visual/camera/audio/text instructions are swallowed by a
    // greedy title match.
    let label = `Shot ${prefixMatch?.[1] ?? index + 1}`;
    let body = rawChunk;
    if (prefixMatch && hasLineBreak) {
      const firstLine = rawChunk.split(/\r?\n/, 1)[0]?.trim() ?? "";
      if (firstLine) {
        label = firstLine;
        body = rawChunk.slice(firstLine.length).trim();
      }
    }

    const cameraDirection = extractLabeledLine(body, [/(?:camera|camera direction)\s*[:\-]\s*(.+)/i]);
    const audioCue = extractLabeledLine(body, [/(?:audio|audio cue|lyric cue|audio & lyric cues?)\s*[:\-]\s*(.+)/i]);
    const onScreenText = extractLabeledLine(body, [/(?:on[- ]screen text|text)\s*[:\-]\s*(.+)/i]);

    return [{
      label,
      start,
      end,
      rawText: rawChunk,
      visualDirection: body,
      cameraDirection,
      audioCue,
      onScreenText,
    }];
  });

  return shots.length ? { mode: "structured", rawText, shots } : { mode: "general", rawText };
}
