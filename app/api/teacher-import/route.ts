import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import { isTeacherSessionValid } from "@/lib/teacher-auth";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_RECORDS = 500;
const MAX_PDF_PAGES = 50;

type ImportField = "id" | "name" | "father" | "age" | "gender" | "photo" | "currentScore" | "scores";

type ImportRecord = {
  rowNumber: number;
  id?: string;
  name: string;
  father?: string;
  age?: number;
  gender?: "Boy" | "Girl";
  photo?: string;
  currentScore?: number;
  scores?: number[];
};

const aliases: Record<ImportField, string[]> = {
  id: ["id", "studentid", "studentnumber", "rollno", "rollnumber", "roll", "admissionnumber"],
  name: ["name", "studentname", "fullname", "studentfullname"],
  father: ["father", "fathername", "fathersname", "guardian", "guardianname", "parentname"],
  age: ["age"],
  gender: ["gender", "sex"],
  photo: ["photo", "photourl", "imageurl", "picture"],
  currentScore: ["score", "currentscore", "latestscore"],
  scores: ["scores", "scorehistory", "assessmenthistory", "assessments"],
};

function normalizeHeader(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellText(value: ExcelJS.CellValue | string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String(value.text ?? "").trim();
  if (typeof value === "object" && "richText" in value) {
    return value.richText.map((item) => item.text).join("").trim();
  }
  return String(value).trim();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(value.trim());
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function findHeader(rows: string[][]) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const indexes = new Map<ImportField, number>();
    for (let columnIndex = 0; columnIndex < rows[rowIndex].length; columnIndex += 1) {
      const header = normalizeHeader(rows[rowIndex][columnIndex]);
      const match = (Object.keys(aliases) as ImportField[]).find((field) => aliases[field].includes(header));
      if (match && !indexes.has(match)) indexes.set(match, columnIndex);
    }
    if (indexes.has("name")) return { rowIndex, indexes };
  }
  return null;
}

function parseScore(value: string) {
  if (value.trim() === "") return undefined;
  const score = Number(value.replace(/%$/, "").trim());
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
}

function parseRows(rows: string[][]) {
  const header = findHeader(rows);
  if (!header) {
    return { records: [] as ImportRecord[], errors: ["A header row with a Name or Student Name column was not found."] };
  }

  const records: ImportRecord[] = [];
  const errors: string[] = [];
  const seenNames = new Set<string>();
  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex];
    if (!cells.some((cell) => cell.trim() !== "")) continue;
    const lineNumber = rowIndex + 1;
    const get = (field: ImportField) => cells[header.indexes.get(field) ?? -1]?.trim() ?? "";
    const name = get("name");
    if (!name) {
      errors.push(`Row ${lineNumber}: name is empty.`);
      continue;
    }
    if (normalizeHeader(name) === "name" || normalizeHeader(name) === "studentname") continue;
    const normalizedName = name.trim().toLowerCase();
    if (seenNames.has(normalizedName)) {
      errors.push(`Row ${lineNumber}: "${name}" appears more than once in this file.`);
      continue;
    }
    seenNames.add(normalizedName);

    const record: ImportRecord = { rowNumber: lineNumber, name };
    const id = get("id");
    const father = get("father");
    const ageValue = get("age");
    const genderValue = get("gender").toLowerCase();
    const photo = get("photo");
    const currentScoreValue = get("currentScore");
    const scoresValue = get("scores");
    if (id) record.id = id;
    if (father) record.father = father;
    if (photo) record.photo = photo;

    if (ageValue) {
      const age = Number(ageValue);
      if (!Number.isInteger(age) || age < 1 || age > 120) {
        errors.push(`Row ${lineNumber}: age must be a whole number between 1 and 120.`);
        continue;
      }
      record.age = age;
    }

    if (genderValue) {
      if (["boy", "male", "m"].includes(genderValue)) record.gender = "Boy";
      else if (["girl", "female", "f"].includes(genderValue)) record.gender = "Girl";
      else {
        errors.push(`Row ${lineNumber}: gender must be Boy or Girl.`);
        continue;
      }
    }

    if (currentScoreValue) {
      const score = parseScore(currentScoreValue);
      if (score === null) {
        errors.push(`Row ${lineNumber}: current score must be between 0 and 100.`);
        continue;
      }
      if (score !== undefined) record.currentScore = score;
    }

    if (scoresValue) {
      const scores = scoresValue.split(/[;,|]/).map((value) => parseScore(value));
      if (scores.some((score) => score === null || score === undefined)) {
        errors.push(`Row ${lineNumber}: score history must contain scores from 0 to 100, separated by commas or semicolons.`);
        continue;
      }
      record.scores = scores.filter((score): score is number => score !== null && score !== undefined);
    }

    if (record.photo && (!/^https?:\/\//i.test(record.photo) || record.photo.length > 2048)) {
      errors.push(`Row ${lineNumber}: photo URL must begin with http:// or https:// and be no longer than 2048 characters.`);
      continue;
    }

    records.push(record);
    if (records.length > MAX_RECORDS) {
      return { records: [] as ImportRecord[], errors: [`Import is limited to ${MAX_RECORDS} students per file.`] };
    }
  }

  return { records, errors };
}

async function spreadsheetRows(buffer: Buffer, extension: string) {
  if (extension === ".csv") {
    const text = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
    return parseCsv(text);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.from([buffer]));
  const rows: string[][] = [];
  const sheet = workbook.worksheets.find((worksheet) => worksheet.rowCount > 0);
  sheet?.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => cells.push(cellText(cell.value)));
    rows.push(cells);
  });
  return rows;
}

async function pdfRows(buffer: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true });
  const document = await task.promise;
  try {
    const rows: string[][] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, MAX_PDF_PAGES); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: { y: number; items: { x: number; text: string }[] }[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const textItem = item as TextItem;
        const x = textItem.transform[4];
        const y = textItem.transform[5];
        const line = lines.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
        if (line) line.items.push({ x, text: textItem.str.trim() });
        else lines.push({ y, items: [{ x, text: textItem.str.trim() }] });
      }
      lines.sort((first, second) => second.y - first.y);
      for (const line of lines) line.items.sort((first, second) => first.x - second.x);

      const headerIndex = lines.findIndex((line) =>
        line.items.some((item) =>
          aliases.name.includes(normalizeHeader(item.text)),
        ),
      );
      if (headerIndex < 0) continue;

      const columns = lines[headerIndex].items
        .map((item) => ({ ...item, field: (Object.keys(aliases) as ImportField[]).find((field) => aliases[field].includes(normalizeHeader(item.text))) }))
        .filter((item): item is typeof item & { field: ImportField } => item.field !== undefined);
      if (!columns.some((column) => column.field === "name")) continue;
      columns.sort((first, second) => first.x - second.x);
      const nameColumn = columns.findIndex((column) => column.field === "name");
      rows.push(columns.map((column) => column.text));

      for (const line of lines.slice(headerIndex + 1)) {
        const cells = columns.map(() => "");
        for (const item of line.items) {
          let closestIndex = 0;
          let closestDistance = Number.POSITIVE_INFINITY;
          for (let index = 0; index < columns.length; index += 1) {
            const distance = Math.abs(item.x - columns[index].x);
            if (distance < closestDistance) {
              closestIndex = index;
              closestDistance = distance;
            }
          }
          cells[closestIndex] = `${cells[closestIndex]}${cells[closestIndex] ? " " : ""}${item.text}`;
        }
        if (cells[nameColumn] && !/^page\s+\d+$/i.test(cells[nameColumn])) rows.push(cells);
      }
    }
    return rows;
  } finally {
    await document.destroy();
  }
}

export async function POST(request: NextRequest) {
  if (!isTeacherSessionValid(request)) {
    return NextResponse.json({ error: "Teacher sign-in is required to import student data." }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a CSV, XLSX, or PDF file." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File must be smaller than 5 MB and cannot be empty." }, { status: 400 });
  }

  const extension = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (![".csv", ".xlsx", ".pdf"].includes(extension)) {
    return NextResponse.json({ error: "Supported formats are CSV, Excel (.xlsx), and text-based PDF." }, { status: 415 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = extension === ".pdf" ? await pdfRows(buffer) : await spreadsheetRows(buffer, extension);
    const result = parseRows(rows);
    if (result.records.length === 0 && result.errors.length === 0) {
      result.errors.push("No student rows were found in this file.");
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Student file import failed:", error instanceof Error ? error.message : "Unknown parser error.");
    return NextResponse.json(
      { error: "The file could not be read. Check that it is not damaged or password-protected." },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
}
