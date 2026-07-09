import { describe, it, expect } from "vitest";
import { isClientStaffAccount, canClientSelfDeleteAccount, canClientSendChatMessage } from "./clientAccess";

describe("isClientStaffAccount", () => {
  it("is true only when isEmployee is explicitly true", () => {
    expect(isClientStaffAccount({ isEmployee: true })).toBe(true);
    expect(isClientStaffAccount({ isEmployee: false })).toBe(false);
    expect(isClientStaffAccount({ isEmployee: undefined })).toBe(false);
    expect(isClientStaffAccount({})).toBe(false);
  });
});

describe("canClientSelfDeleteAccount", () => {
  it("allows the company owner account to self-delete", () => {
    expect(canClientSelfDeleteAccount({ isEmployee: false })).toBe(true);
    expect(canClientSelfDeleteAccount({})).toBe(true);
  });

  it("blocks a Client Staff account from self-deleting — MARAS Admin only", () => {
    expect(canClientSelfDeleteAccount({ isEmployee: true })).toBe(false);
  });
});

describe("canClientSendChatMessage", () => {
  it("customer-chat-enablement-safety-review: gives Client Staff the same chat send capability as the company owner", () => {
    expect(canClientSendChatMessage({ isEmployee: true })).toBe(true);
    expect(canClientSendChatMessage({ isEmployee: false })).toBe(true);
    expect(canClientSendChatMessage({})).toBe(true);
  });
});
