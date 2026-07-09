import { describe, it, expect } from "vitest";
import {
  isDocumentVisibleForShare,
  isDocumentVisibleToDriver,
  isDocumentVisibleToClient,
  buildPublicShareDocumentPath,
  resolveNewDocumentSharedExternally,
} from "./documentAccess";
import type { DocumentCategory } from "../types";

const sharedShipment = { isLinkShared: true, shareIncludeDocuments: true, shareIncludePhotos: true };

describe("isDocumentVisibleForShare", () => {
  it("allows a shared, visible document on a shared shipment", () => {
    expect(isDocumentVisibleForShare({ isSharedExternally: true, category: "cmr" }, sharedShipment)).toBe(true);
  });

  it("BUG-12: blocks a document once isSharedExternally is turned off, even though the shipment link is still shared", () => {
    expect(isDocumentVisibleForShare({ isSharedExternally: false, category: "cmr" }, sharedShipment)).toBe(false);
  });

  it("blocks everything when the shipment's public link itself is off", () => {
    expect(
      isDocumentVisibleForShare(
        { isSharedExternally: true, category: "cmr" },
        { isLinkShared: false, shareIncludeDocuments: true, shareIncludePhotos: true }
      )
    ).toBe(false);
  });

  it("gates non-photo documents on shareIncludeDocuments specifically", () => {
    expect(
      isDocumentVisibleForShare(
        { isSharedExternally: true, category: "invoice" },
        { isLinkShared: true, shareIncludeDocuments: false, shareIncludePhotos: true }
      )
    ).toBe(false);
  });

  it("gates photo documents on shareIncludePhotos specifically", () => {
    expect(
      isDocumentVisibleForShare(
        { isSharedExternally: true, category: "photo" },
        { isLinkShared: true, shareIncludeDocuments: true, shareIncludePhotos: false }
      )
    ).toBe(false);
    expect(
      isDocumentVisibleForShare(
        { isSharedExternally: true, category: "photo" },
        { isLinkShared: true, shareIncludeDocuments: false, shareIncludePhotos: true }
      )
    ).toBe(true);
  });

  it("never exposes an invoice/other document via the public share link, even if fully shared", () => {
    expect(
      isDocumentVisibleForShare({ isSharedExternally: true, category: "invoice" }, sharedShipment)
    ).toBe(false);
    expect(
      isDocumentVisibleForShare({ isSharedExternally: true, category: "other" }, sharedShipment)
    ).toBe(false);
  });
});

describe("isDocumentVisibleToDriver", () => {
  const driverSafe: DocumentCategory[] = ["cmr", "packing_list", "customs", "delivery_proof"];
  const driverBlocked: DocumentCategory[] = ["invoice", "photo", "other"];

  it("allows operational document categories", () => {
    for (const category of driverSafe) {
      expect(isDocumentVisibleToDriver({ category })).toBe(true);
    }
  });

  it("never allows invoice/accounting/catch-all categories, regardless of isSharedExternally", () => {
    for (const category of driverBlocked) {
      expect(isDocumentVisibleToDriver({ category })).toBe(false);
    }
  });
});

describe("isDocumentVisibleToClient", () => {
  it("keeps customer-safe operational categories visible unconditionally", () => {
    const categories: DocumentCategory[] = ["cmr", "packing_list", "customs", "delivery_proof", "photo"];
    for (const category of categories) {
      expect(isDocumentVisibleToClient({ category, isSharedExternally: false })).toBe(true);
      expect(isDocumentVisibleToClient({ category, isSharedExternally: true })).toBe(true);
    }
  });

  it("hides invoice/other documents from the client until explicitly approved", () => {
    expect(isDocumentVisibleToClient({ category: "invoice", isSharedExternally: false })).toBe(false);
    expect(isDocumentVisibleToClient({ category: "other", isSharedExternally: false })).toBe(false);
  });

  it("shows invoice/other documents to the client once isSharedExternally is explicitly true", () => {
    expect(isDocumentVisibleToClient({ category: "invoice", isSharedExternally: true })).toBe(true);
    expect(isDocumentVisibleToClient({ category: "other", isSharedExternally: true })).toBe(true);
  });
});

describe("buildPublicShareDocumentPath", () => {
  it("builds a same-origin proxy path, never the raw Storage URL", () => {
    expect(buildPublicShareDocumentPath("tok123", "doc-1")).toBe("/api/share/tok123/documents/doc-1");
  });

  it("URL-encodes the token and doc id", () => {
    expect(buildPublicShareDocumentPath("tok/123", "doc 1")).toBe("/api/share/tok%2F123/documents/doc%201");
  });
});

describe("resolveNewDocumentSharedExternally", () => {
  it("PR #46: defaults a new document to internal-only when no explicit flag is given", () => {
    expect(resolveNewDocumentSharedExternally(undefined)).toBe(false);
  });

  it("keeps a document internal-only when explicitly set to false", () => {
    expect(resolveNewDocumentSharedExternally(false)).toBe(false);
  });

  it("only opts a document into public visibility on an explicit true", () => {
    expect(resolveNewDocumentSharedExternally(true)).toBe(true);
  });
});
