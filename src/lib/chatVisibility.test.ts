import { describe, it, expect } from "vitest";
import {
  filterChatMessagesByRole,
  resolveOutgoingChatChannel,
  resolveSeenChannelFilter,
  shouldNotifyChatParty,
  isChatNotificationVisibleToRole,
  canAccessInternalStaffChannel,
} from "./chatVisibility";
import type { ChatChannel } from "../types";

type Msg = { id: string; channel?: ChatChannel };

function msgs(): Msg[] {
  return [
    { id: "driver-1", channel: "driver_admin" },
    { id: "client-1", channel: "client_admin" },
    { id: "internal-1", channel: "internal_staff" },
    { id: "legacy-1" }, // pre-BUG-03 message with no channel tag
  ];
}

describe("filterChatMessagesByRole", () => {
  it("gives a driver only driver_admin messages, never client_admin, internal_staff, or legacy untagged ones", () => {
    const result = filterChatMessagesByRole(msgs(), "driver");
    expect(result.map((m) => m.id)).toEqual(["driver-1"]);
  });

  it("gives a client only client_admin messages, never driver_admin, internal_staff, or legacy untagged ones", () => {
    const result = filterChatMessagesByRole(msgs(), "client");
    expect(result.map((m) => m.id)).toEqual(["client-1"]);
  });

  it("gives a driver only driver_admin messages even if it explicitly requests internal_staff via query param", () => {
    const result = filterChatMessagesByRole(msgs(), "driver", "internal_staff");
    expect(result.map((m) => m.id)).toEqual(["driver-1"]);
  });

  it("gives a client only client_admin messages even if it explicitly requests internal_staff via query param", () => {
    const result = filterChatMessagesByRole(msgs(), "client", "internal_staff");
    expect(result.map((m) => m.id)).toEqual(["client-1"]);
  });

  it("gives admin everything (all channels + legacy) when no channel is requested", () => {
    const result = filterChatMessagesByRole(msgs(), "admin");
    expect(result.map((m) => m.id)).toEqual(["driver-1", "client-1", "internal-1", "legacy-1"]);
  });

  it("scopes admin to a single channel when requested via query param", () => {
    expect(filterChatMessagesByRole(msgs(), "admin", "driver_admin").map((m) => m.id)).toEqual(["driver-1"]);
    expect(filterChatMessagesByRole(msgs(), "admin", "client_admin").map((m) => m.id)).toEqual(["client-1"]);
  });

  it("scopes admin to internal_staff only, never mixed with driver_admin/client_admin/legacy", () => {
    expect(filterChatMessagesByRole(msgs(), "admin", "internal_staff").map((m) => m.id)).toEqual(["internal-1"]);
  });

  it("ignores a garbage channel query param for admin and falls back to everything", () => {
    const result = filterChatMessagesByRole(msgs(), "admin", "not-a-real-channel");
    expect(result.map((m) => m.id)).toEqual(["driver-1", "client-1", "internal-1", "legacy-1"]);
  });
});

describe("resolveOutgoingChatChannel", () => {
  it("forces driver-sent messages to driver_admin regardless of any client-supplied value", () => {
    expect(resolveOutgoingChatChannel("driver")).toBe("driver_admin");
    expect(resolveOutgoingChatChannel("driver", "client_admin")).toBe("driver_admin");
    expect(resolveOutgoingChatChannel("driver", "internal_staff")).toBe("driver_admin");
  });

  it("forces client-sent messages to client_admin regardless of any client-supplied value", () => {
    expect(resolveOutgoingChatChannel("client")).toBe("client_admin");
    expect(resolveOutgoingChatChannel("client", "driver_admin")).toBe("client_admin");
    expect(resolveOutgoingChatChannel("client", "internal_staff")).toBe("client_admin");
  });

  it("honors an explicit valid channel from admin, including internal_staff", () => {
    expect(resolveOutgoingChatChannel("admin", "driver_admin")).toBe("driver_admin");
    expect(resolveOutgoingChatChannel("admin", "client_admin")).toBe("client_admin");
    expect(resolveOutgoingChatChannel("admin", "internal_staff")).toBe("internal_staff");
  });

  it("returns null for admin with no (or invalid) channel, rather than guessing", () => {
    expect(resolveOutgoingChatChannel("admin")).toBeNull();
    expect(resolveOutgoingChatChannel("admin", "garbage")).toBeNull();
  });
});

describe("resolveSeenChannelFilter", () => {
  it("scopes driver/client to their own channel, ignoring an internal_staff request", () => {
    expect(resolveSeenChannelFilter("driver")).toBe("driver_admin");
    expect(resolveSeenChannelFilter("driver", "internal_staff")).toBe("driver_admin");
    expect(resolveSeenChannelFilter("client")).toBe("client_admin");
    expect(resolveSeenChannelFilter("client", "internal_staff")).toBe("client_admin");
  });

  it("honors an explicit admin channel (including internal_staff), else returns null (no restriction)", () => {
    expect(resolveSeenChannelFilter("admin", "driver_admin")).toBe("driver_admin");
    expect(resolveSeenChannelFilter("admin", "internal_staff")).toBe("internal_staff");
    expect(resolveSeenChannelFilter("admin")).toBeNull();
  });
});

describe("canAccessInternalStaffChannel", () => {
  it("allows only admin", () => {
    expect(canAccessInternalStaffChannel("admin")).toBe(true);
    expect(canAccessInternalStaffChannel("driver")).toBe(false);
    expect(canAccessInternalStaffChannel("client")).toBe(false);
  });
});

describe("shouldNotifyChatParty", () => {
  it("keeps non-chat notification types unrestricted for both parties", () => {
    expect(shouldNotifyChatParty("status_update", "driver", "client_admin")).toBe(true);
    expect(shouldNotifyChatParty("status_update", "client", "driver_admin")).toBe(true);
  });

  it("only notifies the matching party for a chat notification", () => {
    expect(shouldNotifyChatParty("chat", "driver", "driver_admin")).toBe(true);
    expect(shouldNotifyChatParty("chat", "client", "driver_admin")).toBe(false);
    expect(shouldNotifyChatParty("chat", "client", "client_admin")).toBe(true);
    expect(shouldNotifyChatParty("chat", "driver", "client_admin")).toBe(false);
  });

  it("never notifies driver or client for an internal_staff chat notification", () => {
    expect(shouldNotifyChatParty("chat", "driver", "internal_staff")).toBe(false);
    expect(shouldNotifyChatParty("chat", "client", "internal_staff")).toBe(false);
  });
});

describe("isChatNotificationVisibleToRole", () => {
  it("lets non-chat notifications through for any role", () => {
    expect(isChatNotificationVisibleToRole("status_update", "driver")).toBe(true);
    expect(isChatNotificationVisibleToRole("status_update", "client")).toBe(true);
  });

  it("only shows chat notifications to the matching audience", () => {
    expect(isChatNotificationVisibleToRole("chat", "driver", "driver_admin")).toBe(true);
    expect(isChatNotificationVisibleToRole("chat", "driver", "client_admin")).toBe(false);
    expect(isChatNotificationVisibleToRole("chat", "client", "client_admin")).toBe(true);
    expect(isChatNotificationVisibleToRole("chat", "client", "driver_admin")).toBe(false);
  });

  it("withholds legacy untagged chat notifications from driver/client", () => {
    expect(isChatNotificationVisibleToRole("chat", "driver")).toBe(false);
    expect(isChatNotificationVisibleToRole("chat", "client")).toBe(false);
  });

  it("always shows chat notifications to admin", () => {
    expect(isChatNotificationVisibleToRole("chat", "admin")).toBe(true);
    expect(isChatNotificationVisibleToRole("chat", "admin", "driver_admin")).toBe(true);
    expect(isChatNotificationVisibleToRole("chat", "admin", "internal_staff")).toBe(true);
  });

  it("never shows an internal_staff chat notification to driver or client", () => {
    expect(isChatNotificationVisibleToRole("chat", "driver", "internal_staff")).toBe(false);
    expect(isChatNotificationVisibleToRole("chat", "client", "internal_staff")).toBe(false);
  });
});
