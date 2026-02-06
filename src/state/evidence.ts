// src/state/evidence.ts
import * as vscode from "vscode";
import { EvidenceItem, EvidenceType } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix = "ev"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeEvidence(params: {
  type: EvidenceType;
  title: string;
  ref: string;
  snippet?: string;
  whyIncluded: string;
  source?: EvidenceItem["source"];
}): EvidenceItem {
  return {
    id: newId(),
    type: params.type,
    title: params.title,
    ref: params.ref,
    snippet: params.snippet,
    whyIncluded: params.whyIncluded,
    createdAt: nowIso(),
    source: params.source ?? "user",
  };
}

export function formatRefFromRange(uri: vscode.Uri, range: vscode.Range): string {
  const file = uri.fsPath;
  // 1-based line numbers are easier for humans
  const startLine = range.start.line + 1;
  const endLine = range.end.line + 1;
  return `${file}:${startLine}-${endLine}`;
}
