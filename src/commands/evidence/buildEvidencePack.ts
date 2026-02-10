import * as vscode from "vscode";
import { SessionStore } from "../../state/sessionStore";
import { formatRefFromRange, makeEvidence } from "../../state/evidence";
import { EvidenceItem } from "../../state/types";

function sevToString(sev: vscode.DiagnosticSeverity): string {
  switch (sev) {
    case vscode.DiagnosticSeverity.Error:
      return "Error";
    case vscode.DiagnosticSeverity.Warning:
      return "Warning";
    case vscode.DiagnosticSeverity.Information:
      return "Info";
    case vscode.DiagnosticSeverity.Hint:
      return "Hint";
    default:
      return "Unknown";
  }
}

function appendUnique(target: EvidenceItem[], existingRefs: Set<string>, item: EvidenceItem) {
  const key = `${item.type}:${item.ref}`;
  if (existingRefs.has(key)) return;
  existingRefs.add(key);
  target.push(item);
}

export async function buildEvidencePack(store: SessionStore) {
  const session = store.get() ?? (await store.create("standard"));
  const existingRefs = new Set(
    (session.evidence ?? []).map((it) => `${it.type}:${it.ref}`)
  );

  const collected: EvidenceItem[] = [];
  const editor = vscode.window.activeTextEditor;

  if (editor) {
    const filePath = editor.document.uri.fsPath;
    appendUnique(
      collected,
      existingRefs,
      makeEvidence({
        type: "file",
        title: "Active file",
        ref: filePath,
        whyIncluded: "Currently edited file for this session.",
        source: "auto",
      })
    );

    if (!editor.selection.isEmpty) {
      const selectionText = editor.document.getText(editor.selection).slice(0, 4000);
      appendUnique(
        collected,
        existingRefs,
        makeEvidence({
          type: "selection",
          title: "Active selection",
          ref: formatRefFromRange(editor.document.uri, editor.selection),
          snippet: selectionText,
          whyIncluded: "Selected code is likely tied to current implementation scope.",
          source: "auto",
        })
      );
    }
  }

  const diagnostics = vscode.languages
    .getDiagnostics()
    .flatMap(([uri, diags]) => diags.map((d) => ({ uri, d })))
    .sort((a, b) => (a.d.severity ?? 99) - (b.d.severity ?? 99))
    .slice(0, 8);

  for (const { uri, d } of diagnostics) {
    const line = d.range.start.line + 1;
    const ch = d.range.start.character + 1;
    appendUnique(
      collected,
      existingRefs,
      makeEvidence({
        type: "diagnostic",
        title: `${sevToString(d.severity)}: ${d.message}`,
        ref: `${uri.fsPath}:${line}:${ch}`,
        snippet: d.source ? `source: ${d.source}` : undefined,
        whyIncluded: "Diagnostics provide concrete failure points and verification hints.",
        source: "auto",
      })
    );
  }

  if (collected.length === 0) {
    vscode.window.showInformationMessage("Ground: No new raw evidence found for this pack.");
    return;
  }

  await store.addEvidence(collected);
  vscode.window.showInformationMessage(`Ground: Evidence Pack built with ${collected.length} new raw items.`);
}

