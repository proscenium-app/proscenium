// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** PDF 1.7 logical structure. The tree determines reading order independently
 * of drawing order; page-local MCIDs and ParentTree link every text sequence
 * back to its owning paragraph. This does not claim PDF/UA conformance.
 * Reference: ISO 32000, sections 14.6–14.9 (marked content and logical structure).
 */
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
  type PDFRef,
} from "pdf-lib";

export interface PdfElement {
  ref: PDFRef;
  children: PDFArray;
  tag: string;
}

export class TaggedPdf {
  readonly document: PdfElement;
  private readonly parentNums: PDFArray;
  private readonly pages = new Map<PDFPage, PDFArray>();
  private readonly root;

  constructor(private readonly pdf: PDFDocument) {
    const context = pdf.context;
    this.parentNums = context.obj([]);
    const parentTree = context.register(context.obj({ Nums: this.parentNums }));
    this.root = context.obj({
      Type: "StructTreeRoot",
      ParentTree: parentTree,
      ParentTreeNextKey: 0,
      RoleMap: { Speech: "Div", Speaker: "P", Dialogue: "P", StageDirection: "P" },
    });
    const rootRef = context.register(this.root);
    const children = context.obj([]);
    const ref = context.register(
      context.obj({ Type: "StructElem", S: "Document", P: rootRef, K: children }),
    );
    this.document = { ref, children, tag: "Document" };
    this.root.set(PDFName.of("K"), context.obj([ref]));
    pdf.catalog.set(PDFName.of("StructTreeRoot"), rootRef);
    pdf.catalog.set(PDFName.of("MarkInfo"), context.obj({ Marked: true }));
  }

  element(tag: string, parent = this.document, title?: string): PdfElement {
    const context = this.pdf.context;
    const children = context.obj([]);
    const dictionary = context.obj({ Type: "StructElem", S: tag, P: parent.ref, K: children });
    if (title) dictionary.set(PDFName.of("T"), PDFHexString.fromText(title));
    const ref = context.register(dictionary);
    parent.children.push(ref);
    return { ref, children, tag };
  }

  content(page: PDFPage, element: PdfElement, draw: () => void): void {
    const context = this.pdf.context;
    let parents = this.pages.get(page);
    if (!parents) {
      const key = this.pages.size;
      parents = context.obj([]);
      this.pages.set(page, parents);
      this.parentNums.push(PDFNumber.of(key));
      this.parentNums.push(context.register(parents));
      page.node.set(PDFName.of("StructParents"), PDFNumber.of(key));
      page.node.set(PDFName.of("Tabs"), PDFName.of("S"));
      this.root.set(PDFName.of("ParentTreeNextKey"), PDFNumber.of(key + 1));
    }
    const mcid = parents.size();
    parents.push(element.ref);
    element.children.push(context.obj({ Type: "MCR", Pg: page.ref, MCID: mcid }));
    // PDFOperator's typed arguments omit PDFDict. The serialized property list
    // contains only this page's generated integer, never unsanitized source text.
    page.pushOperators(
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
        PDFName.of(element.tag),
        `<< /MCID ${mcid} >>`,
      ]),
    );
    try {
      draw();
    } finally {
      page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
    }
  }

  artifact(page: PDFPage, draw: () => void): void {
    page.pushOperators(
      PDFOperator.of(PDFOperatorNames.BeginMarkedContent, [PDFName.of("Artifact")]),
    );
    try {
      draw();
    } finally {
      page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
    }
  }
}
