import { describe, it, expect } from "vitest";
import {
  resolvePrimaryMobileTabs,
  resolveMoreMenuTabIds,
  isMoreTabActive,
  PRIMARY_TAB_PRIORITY,
  type MobileNavTab,
} from "./mobileAdminNav";

const tab = (id: string): MobileNavTab => ({ id });

describe("resolvePrimaryMobileTabs", () => {
  it("picks the 4 ideal tabs in priority order when all are present (super/operation admin)", () => {
    const tabs = [
      tab("dashboard"),
      tab("shipments"),
      tab("drivers"),
      tab("tracking_map"),
      tab("clients"),
      tab("chat_center"),
      tab("costs"),
    ].map((t) => t);
    // Shuffle order to confirm output follows PRIMARY_TAB_PRIORITY, not input order.
    const shuffled = [tabs[4], tabs[1], tabs[6], tabs[0], tabs[2], tabs[3], tabs[5]];
    expect(resolvePrimaryMobileTabs(shuffled)).toEqual(PRIMARY_TAB_PRIORITY);
  });

  it("fills remaining slots from whatever else is available when an accounts admin has 0 of the 4 ideal tabs", () => {
    const tabs = [tab("clients"), tab("vendors"), tab("costs"), tab("team")];
    const result = resolvePrimaryMobileTabs(tabs);
    expect(result).toHaveLength(4);
    expect(result).toEqual(["clients", "vendors", "costs", "team"]);
    // Never invents an id that wasn't in the input.
    result.forEach((id) => expect(tabs.some((t) => t.id === id)).toBe(true));
  });

  it("fills partial availability (2 of 4 ideal tabs) with the remaining real tabs", () => {
    const tabs = [tab("dashboard"), tab("chat_center"), tab("clients"), tab("vendors")];
    const result = resolvePrimaryMobileTabs(tabs);
    expect(result).toEqual(["dashboard", "chat_center", "clients", "vendors"]);
  });

  it("never returns more than 4 ids even with many tabs available", () => {
    const tabs = ["dashboard", "shipments", "tracking_map", "chat_center", "clients", "drivers"].map(tab);
    expect(resolvePrimaryMobileTabs(tabs)).toHaveLength(4);
  });

  it("returns fewer than 4 if the role has fewer than 4 tabs total", () => {
    const tabs = [tab("clients")];
    expect(resolvePrimaryMobileTabs(tabs)).toEqual(["clients"]);
  });
});

describe("resolveMoreMenuTabIds", () => {
  it("returns every tab not already in the primary slots", () => {
    const tabs = ["dashboard", "shipments", "tracking_map", "chat_center", "clients", "drivers", "costs"].map(tab);
    const primary = ["dashboard", "shipments", "tracking_map", "chat_center"];
    expect(resolveMoreMenuTabIds(tabs, primary)).toEqual(["clients", "drivers", "costs"]);
  });

  it("appends extraIds (e.g. 'team') without duplicating and without including a primary id", () => {
    const tabs = ["dashboard", "shipments", "tracking_map", "chat_center", "clients"].map(tab);
    const primary = ["dashboard", "shipments", "tracking_map", "chat_center"];
    expect(resolveMoreMenuTabIds(tabs, primary, ["team"])).toEqual(["clients", "team"]);
    // extraIds already present in tabs is not duplicated.
    expect(resolveMoreMenuTabIds(tabs, primary, ["clients"])).toEqual(["clients"]);
    // extraIds that collide with a primary id is dropped, never shown twice.
    expect(resolveMoreMenuTabIds(tabs, primary, ["dashboard"])).toEqual(["clients"]);
  });

  it("returns an empty array when every tab is already primary", () => {
    const tabs = ["dashboard", "shipments", "tracking_map", "chat_center"].map(tab);
    const primary = ["dashboard", "shipments", "tracking_map", "chat_center"];
    expect(resolveMoreMenuTabIds(tabs, primary)).toEqual([]);
  });
});

describe("isMoreTabActive", () => {
  const primary = ["dashboard", "shipments", "tracking_map", "chat_center"];

  it("is false when the active tab is one of the primary slots", () => {
    expect(isMoreTabActive("dashboard", primary)).toBe(false);
    expect(isMoreTabActive("chat_center", primary)).toBe(false);
  });

  it("is true when the active tab is only reachable via More", () => {
    expect(isMoreTabActive("clients", primary)).toBe(true);
    expect(isMoreTabActive("settings", primary)).toBe(true);
    expect(isMoreTabActive("team", primary)).toBe(true);
  });
});
