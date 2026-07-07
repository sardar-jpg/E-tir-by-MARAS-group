import { describe, it, expect } from "vitest";
import { isDocumentVisibleForShare, buildPublicShareDocumentPath } from "./documentAccess";

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
});

describe("buildPublicShareDocumentPath", () => {
  it("builds a same-origin proxy path, never the raw Storage URL", () => {
    expect(buildPublicShareDocumentPath("tok123", "doc-1")).toBe("/api/share/tok123/documents/doc-1");
  });

  it("URL-encodes the token and doc id", () => {
    expect(buildPublicShareDocumentPath("tok/123", "doc 1")).toBe("/api/share/tok%2F123/documents/doc%201");
  });
});
