import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { DocumentCategory } from "../types";
import {
  DOCUMENT_CATEGORY_POLICIES,
  DOCUMENT_CATEGORY_IDS,
  listDocumentCategories,
  isKnownDocumentCategory,
  normalizeDocumentCategory,
  coerceDocumentCategoryForStorage,
  getDocumentCategoryPolicy,
} from "./shipmentDocuments";

/**
 * Documents-architecture cleanup: one unified Shipment Documents model
 * where every category — CMR included — is nothing but a registry row of
 * metadata flags. These tests pin the registry contract and, at the
 * source level, that no code special-cases CMR anymore.
 */
describe("the category registry — one place, all categories", () => {
  it("supports exactly the specified category set", () => {
    expect([...DOCUMENT_CATEGORY_IDS].sort()).toEqual(
      ["cmr", "invoice", "packing_list", "t1", "tir_carnet", "customs", "delivery_proof", "photo", "other"].sort()
    );
  });

  it("every entry's id matches its registry key, and every entry carries the full policy shape", () => {
    for (const id of DOCUMENT_CATEGORY_IDS) {
      const policy = DOCUMENT_CATEGORY_POLICIES[id];
      expect(policy.id).toBe(id);
      expect(typeof policy.label).toBe("string");
      expect(policy.label.length).toBeGreaterThan(0);
      for (const flag of ["driverVisible", "driverUploadable", "requiresExplicitClientShare", "sharesAsPhoto"] as const) {
        expect(typeof policy[flag]).toBe("boolean");
      }
    }
    expect(listDocumentCategories()).toHaveLength(DOCUMENT_CATEGORY_IDS.length);
  });

  it("carries the human labels from the specification", () => {
    expect(DOCUMENT_CATEGORY_POLICIES.cmr.label).toBe("CMR");
    expect(DOCUMENT_CATEGORY_POLICIES.invoice.label).toBe("Commercial Invoice");
    expect(DOCUMENT_CATEGORY_POLICIES.t1.label).toBe("T1");
    expect(DOCUMENT_CATEGORY_POLICIES.tir_carnet.label).toBe("TIR Carnet");
    expect(DOCUMENT_CATEGORY_POLICIES.delivery_proof.label).toBe("Delivery Note / POD");
  });
});

describe("CMR is only a category — no special code path", () => {
  it("CMR's behavior is expressed purely as data flags (its one difference from other operational paperwork is driverUploadable: false)", () => {
    const cmr = DOCUMENT_CATEGORY_POLICIES.cmr;
    const customs = DOCUMENT_CATEGORY_POLICIES.customs;
    expect({ ...cmr, id: "x", label: "x", driverUploadable: true }).toEqual({
      ...customs,
      id: "x",
      label: "x",
    });
  });

  it("documentAccess.ts CODE contains no category literal at all — every rule reads the registry (comments may still explain history)", () => {
    const source = readFileSync(join(__dirname, "documentAccess.ts"), "utf-8");
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const id of DOCUMENT_CATEGORY_IDS) {
      expect(codeOnly).not.toContain(`"${id}"`);
      expect(codeOnly).not.toContain(`'${id}'`);
    }
    expect(codeOnly).not.toMatch(/cmr/i);
  });
});

describe("normalization and write-time coercion", () => {
  it("maps case/whitespace variants onto canonical ids — uniformly, for every category", () => {
    expect(normalizeDocumentCategory("CMR")).toBe("cmr");
    expect(normalizeDocumentCategory(" cmr ")).toBe("cmr");
    expect(normalizeDocumentCategory("TIR_CARNET")).toBe("tir_carnet");
    expect(normalizeDocumentCategory("T1")).toBe("t1");
    expect(normalizeDocumentCategory("Photo")).toBe("photo");
  });

  it("returns null for unrecognized or non-string values instead of guessing", () => {
    for (const bad of ["waybill", "", 123, null, undefined, {}]) {
      expect(normalizeDocumentCategory(bad)).toBeNull();
    }
  });

  it("storage coercion files anything unclassifiable under 'other' — a document can never be stored with a junk category", () => {
    expect(coerceDocumentCategoryForStorage("Invoice")).toBe("invoice");
    expect(coerceDocumentCategoryForStorage("waybill")).toBe("other");
    expect(coerceDocumentCategoryForStorage(undefined)).toBe("other");
  });

  it("isKnownDocumentCategory never treats Object.prototype names as categories", () => {
    expect(isKnownDocumentCategory("toString")).toBe(false);
    expect(isKnownDocumentCategory("constructor")).toBe(false);
  });
});

describe("legacy stored records (pre-coercion junk categories)", () => {
  it("fall back to the conservative unclassified policy: hidden from drivers, client-visible, document-gated on the public link", () => {
    const legacy = getDocumentCategoryPolicy("some-old-junk" as unknown as DocumentCategory);
    expect(legacy.driverVisible).toBe(false);
    expect(legacy.requiresExplicitClientShare).toBe(false);
    expect(legacy.sharesAsPhoto).toBe(false);
    expect(legacy.driverUploadable).toBe(true);
  });

  it("known categories always resolve to their own registry row", () => {
    for (const id of DOCUMENT_CATEGORY_IDS) {
      expect(getDocumentCategoryPolicy(id)).toBe(DOCUMENT_CATEGORY_POLICIES[id]);
    }
  });
});
