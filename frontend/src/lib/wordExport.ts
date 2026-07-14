// wordExport.ts — generate a .docx with proper formatting.
// Only exports AI analysis result (no raw OCR full text — it's too long and noisy).
// Parses markdown (tables, headings, bold, lists, blockquotes) into Word styles.

import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
} from "docx";
import { saveAs } from "file-saver";

function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      runs.push(new TextRun(text.slice(last, m.index)));
    }
    runs.push(new TextRun({ text: m[1], bold: true }));
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    runs.push(new TextRun(text.slice(last)));
  }
  return runs.length ? runs : [new TextRun(text)];
}

function parseTable(lines: string[]): Table {
  const rows: TableRow[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;
      const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      const tableCells = cells.map(
        (c) =>
          new TableCell({
            children: [new Paragraph({ children: parseInline(c) })],
          })
      );
      rows.push(new TableRow({ children: tableCells }));
    }
  }
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function textToParagraphs(text: string): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  let tableBuffer: string[] = [];

  function flushTable() {
    if (tableBuffer.length > 0) {
      blocks.push(parseTable(tableBuffer));
      tableBuffer = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      tableBuffer.push(trimmed);
      i++;
      continue;
    } else {
      flushTable();
    }

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(
        new Paragraph({
          children: parseInline(trimmed.slice(4)),
          heading: HeadingLevel.HEADING_2,
        })
      );
      i++;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push(
        new Paragraph({
          children: parseInline(trimmed.slice(3)),
          heading: HeadingLevel.HEADING_1,
        })
      );
      i++;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push(
        new Paragraph({
          children: parseInline(trimmed.slice(2)),
          heading: HeadingLevel.TITLE,
        })
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("> ")) {
      blocks.push(
        new Paragraph({
          children: parseInline(trimmed.slice(2)),
          indent: { left: 360 },
          spacing: { before: 60, after: 60 },
        })
      );
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      blocks.push(
        new Paragraph({
          children: parseInline(trimmed.replace(/^[-*]\s+/, "")),
          bullet: { level: 0 },
        })
      );
      i++;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      blocks.push(
        new Paragraph({
          children: parseInline(trimmed.replace(/^\d+\.\s+/, "")),
          indent: { left: 360 },
        })
      );
      i++;
      continue;
    }

    blocks.push(new Paragraph({ children: parseInline(trimmed) }));
    i++;
  }
  flushTable();

  return blocks;
}

export async function exportDocx(
  title: string,
  _ocrText: string,
  analysisText?: string
): Promise<void> {
  const children: (Paragraph | Table)[] = [];

  // Title
  children.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    })
  );
  children.push(new Paragraph(""));

  // AI analysis only — no raw OCR full text (too long, too noisy)
  if (analysisText && analysisText.trim()) {
    children.push(
      new Paragraph({
        text: "AI 分析",
        heading: HeadingLevel.HEADING_1,
      })
    );
    children.push(...textToParagraphs(analysisText));
  } else {
    children.push(
      new Paragraph({
        text: "（無 AI 分析結果，請先點擊「AI 分析」按鈕）",
      })
    );
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const safe = (title || "ocr-result").replace(/[^\w\u4e00-\u9fa5.-]+/g, "_");
  saveAs(blob, `${safe}.docx`);
}
