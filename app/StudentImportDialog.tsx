"use client";

import { useMemo, useRef, useState } from "react";
import { FileDown, FileUp, X } from "lucide-react";

export type ImportedStudentRecord = {
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

type ImportResponse = {
  records: ImportedStudentRecord[];
  errors: string[];
  error?: string;
};

type StudentImportDialogProps = {
  students: { name: string; id: string }[];
  onClose: () => void;
  onApply: (records: ImportedStudentRecord[], errors: string[], replaceExisting: boolean) => void;
};

export default function StudentImportDialog({ students, onClose, onApply }: StudentImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [records, setRecords] = useState<ImportedStudentRecord[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const preview = useMemo(
    () =>
      records.map((record) => ({
        record,
        matches: replaceExisting
          ? []
          : students.filter((student) => student.name.trim().toLowerCase() === record.name.trim().toLowerCase()),
        idConflict: Boolean(
          !replaceExisting &&
            record.id &&
            students.some(
              (student) =>
                student.id.toLowerCase() === record.id!.toLowerCase() &&
                student.name.trim().toLowerCase() !== record.name.trim().toLowerCase(),
            ),
        ),
      })),
    [records, replaceExisting, students],
  );
  const newCount = preview.filter(({ matches, idConflict }) => matches.length === 0 && !idConflict).length;
  const updateCount = preview.filter(({ matches, idConflict }) => matches.length === 1 && !idConflict).length;
  const ambiguousCount = preview.filter(({ matches, idConflict }) => matches.length > 1 || idConflict).length;

  async function readFile(file: File) {
    setFileName(file.name);
    setRecords([]);
    setErrors([]);
    setLoading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/teacher-import", { method: "POST", body });
      const result = (await response.json()) as ImportResponse;
      if (!response.ok) {
        setErrors([result.error || "Could not read the selected file."]);
        return;
      }
      setRecords(result.records);
      setErrors(result.errors);
    } catch {
      setErrors(["Could not reach the import service. Check your connection and try again."]);
    } finally {
      setLoading(false);
    }
  }

  function downloadTemplate() {
    const template =
      "Student ID,Name,Father's Name,Age,Gender,Current Score,Score History,Photo URL\nST-1001,Ayesha Khan,Imran Khan,17,Girl,86,\"68;74;79;86\",\n";
    const url = URL.createObjectURL(new Blob([template], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "classmate-students-template.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function applyImport() {
    if (
      replaceExisting &&
      !window.confirm(
        `Replace all ${students.length} current student(s) with the ${records.length} valid student(s) from this file?`,
      )
    ) {
      return;
    }
    onApply(records, errors, replaceExisting);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow blue">CLASS DIRECTORY</span>
            <h2 id="import-title">Import students</h2>
          </div>
          <button className="icon-close" aria-label="Close import dialog" onClick={onClose}>
            <X />
          </button>
        </div>
        <p className="import-intro">
          Upload a CSV, Excel (.xlsx), or text-based PDF with one student per row (up to 5 MB and 500 students).
          Excel imports the first worksheet. Matching names will be updated; blank fields keep their saved values.
        </p>
        <div className="import-guidance">
          <b>Required column: Name</b>
          <span>
            Recognized headers: Student ID, Name, Father&apos;s Name, Age, Gender, Photo URL, Current Score, Score
            History.
          </span>
          <span>PDF files need selectable text and clear columns. Scanned/photo PDFs are not supported.</span>
        </div>
        <button className="text-btn import-template" onClick={downloadTemplate}>
          <FileDown size={16} /> Download CSV template
        </button>
        <label className="import-file-label">
          Choose student file
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.pdf,text/csv,application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </label>
        {fileName && <p className="import-filename">Selected: {fileName}</p>}
        {loading && <p className="import-status">Reading file and checking student rows...</p>}
        <label className="import-replace-option">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(event) => setReplaceExisting(event.target.checked)}
          />
          <span>
            <b>Replace all existing students</b>
            <small>Remove the current student list and keep only valid students from this file.</small>
          </span>
        </label>
        {records.length > 0 && (
          <>
            <div className="import-summary">
              <b>{records.length} valid student row(s)</b>
              <span>
                {newCount} new · {updateCount} updates · {ambiguousCount} ambiguous
              </span>
            </div>
            <div className="import-preview">
              {preview.slice(0, 12).map(({ record, matches, idConflict }) => (
                <div key={`${record.rowNumber}-${record.name}`}>
                  <span>
                    <b>{record.name}</b>
                    <small>{record.father || "Father's name not provided"}</small>
                  </span>
                  <strong className={matches.length > 1 || idConflict ? "import-ambiguous" : ""}>
                    {matches.length === 1 && !idConflict
                      ? "Update"
                      : matches.length > 1 || idConflict
                        ? "Check duplicate"
                        : "Add"}
                  </strong>
                </div>
              ))}
              {records.length > 12 && <p>And {records.length - 12} more rows...</p>}
            </div>
          </>
        )}
        {errors.length > 0 && (
          <div className="import-errors" role="status">
            {errors.slice(0, 8).map((error) => (
              <p key={error}>{error}</p>
            ))}
            {errors.length > 8 && <p>And {errors.length - 8} more issue(s).</p>}
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-btn"
            disabled={loading || records.length === 0}
            onClick={applyImport}
          >
            <FileUp size={16} /> {replaceExisting ? "Replace with" : "Import"} {records.length} student
            {records.length === 1 ? "" : "s"}
          </button>
        </div>
      </section>
    </div>
  );
}
