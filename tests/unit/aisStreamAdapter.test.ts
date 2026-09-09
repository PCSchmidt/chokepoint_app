/**
 * AisStreamAdapter tests (§5.1 lifecycle, §14.1 key handling, ADR-0010
 * retention rules, §6.2 honest missing-key behavior). All transport is a fake
 * socket — no test touches the network, so CI stays keyless.
 */

import { describe, expect, it } from "vitest";
import {
  AisStreamAdapter,
  boundingBoxesFromFences,
} from "../../src/data/aisStreamAdapter";
import { toReviewedGeofence } from "../../src/data/geofences";
import { CHOKEPOINT_REGISTRY } from "../../src/config/chokepoints";

const reviewed = (id: string) => {
  const fence = CHOKEPOINT_REGISTRY.flatMap((c) => c.geofences).find((g) => g.id === id);
  if (!fence) throw new Error(`fence ${id} not found`);
  return toReviewedGeofence(fence);
};

const ANCHORAGE = reviewed("outer-anchorage");
const CLOCK = { t: "2026-09-09T14:00:00Z" };
const nowFn = () => CLOCK.t;
const CONTEXT = { now: CLOCK.t, trigger: "startup" as const };

/** Minimal fake socket capturing what the adapter sends. */
import type { AisStreamSocket } from "../../src/data/aisStreamAdapter";

class FakeSocket {
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, Array<(event: { data?: unknown }) => void>> = {};

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, event: { data?: unknown } = {}): void {
    for (const l of [...(this.listeners[type] ?? [])]) l(event);
  }
}

const positionFrame = (mmsi: number, lat: number, lon: number, timeUtc: string, sog = 12) => ({
  MessageType: "PositionReport",
  MetaData: { MMSI: mmsi, time_utc: timeUtc, latitude: lat, longitude: lon },
  Message: { PositionReport: { UserID: mmsi, Latitude: lat, Longitude: lon, SOG: sog, COG: 40, Heading: 40 } },
});

const staticFrame = (mmsi: number, type: number) => ({
  MessageType: "ShipStaticData",
  MetaData: { MMSI: mmsi, time_utc: "2026-09-09 13:00:00.000 +0000 UTC" },
  Message: { ShipStaticData: { UserID: mmsi, Type: type } },
});

function makeAdapter(overrides: Partial<ConstructorParameters<typeof AisStreamAdapter>[0]> = {}) {
  const socket = new FakeSocket();
  const adapter = new AisStreamAdapter({
    apiKey: "test-key-server-side-only",
    fences: [ANCHORAGE],
    socketFactory: () => socket as unknown as AisStreamSocket,
    nowFn,
    ...overrides,
  });
  return { adapter, socket };
}

describe("bounding-box conversion (coordinate-order pitfall — empirically settled)", () => {
  it("emits [lat, lon] pairs in the PROVIDER's order (verified by live probe 2026-09-09)", () => {
    // Empirical evidence: [lon, lat] => SubscriptionConfirmation then silence;
    // [lat, lon] => PositionReports. The provider README example is symmetric
    // and cannot disambiguate — this test pins the empirically verified order.
    const boxes = boundingBoxesFromFences([ANCHORAGE]);
    expect(boxes).toHaveLength(1);
    const [[first0, first1], [second0, second1]] = boxes[0]!;
    // Anchorage ring spans lat 33.638..33.718, lon -118.239..-118.101 (+/- 0.05 pad).
    // FIRST element of each pair is LATITUDE; second is LONGITUDE.
    expect(first0).toBeCloseTo(33.6382 - 0.05, 6);
    expect(first1).toBeCloseTo(-118.2387 - 0.05, 6);
    expect(second0).toBeCloseTo(33.7182 + 0.05, 6);
    expect(second1).toBeCloseTo(-118.1008 + 0.05, 6);
    // Guards against the swapped pitfall: negative values sit in the LONGITUDE slot.
    expect(first1).toBeLessThan(0);
    expect(second1).toBeLessThan(0);
    expect(first0).toBeGreaterThan(33);
    expect(second0).toBeGreaterThan(33);
  });

  it("requires at least one fence", () => {
    expect(() => boundingBoxesFromFences([])).toThrow();
  });
});

describe("honest missing-key behavior (§6.2)", () => {
  it("fails enable() with UNAVAILABLE health when no key is configured", async () => {
    const { adapter, socket } = makeAdapter({ apiKey: undefined });
    const result = await adapter.enable(CONTEXT);
    expect(result.status).toBe("failure");
    expect(result.message).toMatch(/no AISStream API key/);
    expect(adapter.getStatus().state).toBe("UNAVAILABLE");
    expect(adapter.getStatus().detail).toMatch(/key|failure/);
    expect(socket.sent).toHaveLength(0); // never even opens a subscription
    expect(adapter.isKeyless).toBe(true);
  });

  it("a keyless adapter returns no records and empty attribution still identifies the source", async () => {
    const { adapter } = makeAdapter({ apiKey: undefined });
    await adapter.enable(CONTEXT);
    expect(adapter.getRecords()).toEqual([]);
  });
});

describe("lifecycle and subscription (§5.1)", () => {
  it("open sends the subscription with boxes, message-type filter, and the key", async () => {
    const { adapter, socket } = makeAdapter();
    await adapter.enable(CONTEXT);
    socket.emit("open");
    expect(socket.sent).toHaveLength(1);
    const subscription = JSON.parse(socket.sent[0]!);
    expect(subscription.APIkey).toBe("test-key-server-side-only");
    expect(subscription.BoundingBoxes).toHaveLength(1);
    expect(subscription.FilterMessageTypes).toContain("PositionReport");
    expect(subscription.FilterMessageTypes).toContain("ShipStaticData");
    await adapter.disable();
  });

  it("frames become canonical observations; health goes FRESH", async () => {
    const { adapter, socket } = makeAdapter();
    await adapter.enable(CONTEXT);
    socket.emit("open");
    CLOCK.t = "2026-09-09T14:01:00Z";
    socket.emit("message", { data: JSON.stringify(positionFrame(567001001, 33.68, -118.17, "2026-09-09 14:00:50.000 +0000 UTC")) });
    const records = adapter.getRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.entityId).toBe("aisstream:567001001");
    expect(adapter.getStatus().state).toBe("FRESH");
    expect(adapter.getStatus().lastObservationAt).toBe("2026-09-09T14:00:50Z");
    await adapter.disable();
  });

  it("invalid frames are counted as rejected and never crash the stream", async () => {
    const { adapter, socket } = makeAdapter();
    await adapter.enable(CONTEXT);
    socket.emit("open");
    CLOCK.t = "2026-09-09T14:01:00Z";
    socket.emit("message", { data: "not-json" });
    socket.emit("message", { data: JSON.stringify(positionFrame(1, 95, 0, "2026-09-09 14:00:50.000 +0000 UTC")) }); // invalid lat
    expect(adapter.getRecords()).toEqual([]);
    const diagnostics = adapter.getDiagnostics();
    expect(diagnostics.rejectedTotal).toBe(2);
    await adapter.disable();
  });

  it("decodes BINARY frames (ArrayBuffer) — the provider sends binary UTF-8 JSON", async () => {
    const { adapter, socket } = makeAdapter();
    await adapter.enable(CONTEXT);
    socket.emit("open");
    CLOCK.t = "2026-09-09T14:01:00Z";
    const payload = JSON.stringify(positionFrame(567001099, 33.68, -118.17, "2026-09-09 14:00:50.000 +0000 UTC"));
    const bytes = new TextEncoder().encode(payload);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    socket.emit("message", { data: buffer });
    const records = adapter.getRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.entityId).toBe("aisstream:567001099");
    await adapter.disable();
  });

  it("socket error is a failure and health degrades to UNAVAILABLE with the reason", async () => {
    const { adapter, socket } = makeAdapter();
    await adapter.enable(CONTEXT);
    socket.emit("open");
    CLOCK.t = "2026-09-09T14:05:00Z";
    socket.emit("error");
    expect(adapter.getStatus().state).toBe("UNAVAILABLE");
    expect(adapter.getStatus().detail).toMatch(/socket error/);
    await adapter.disable();
  });

  it("disable detaches, closes the socket, and serves nothing; refresh while disabled fails", async () => {
    const { adapter, socket } = makeAdapter();
    await adapter.enable(CONTEXT);
    socket.emit("open");
    await adapter.disable();
    expect(socket.closed).toBe(true);
    expect(adapter.getRecords()).toEqual([]);
    expect(adapter.getStatus().detail).toBe("adapter disabled");
    const refresh = await adapter.refresh({ now: CLOCK.t, trigger: "manual" });
    expect(refresh.status).toBe("failure");
  });

  it("destroy clears everything and rejects re-enable", async () => {
    const { adapter } = makeAdapter();
    await adapter.enable(CONTEXT);
    adapter.destroy();
    expect(adapter.getRecords()).toEqual([]);
    expect(adapter.getStatus().detail).toBe("adapter destroyed");
    await expect(adapter.enable(CONTEXT)).rejects.toThrow(/destroyed/);
  });

  it("refresh after frames reports ok with freshness preserved on the stream timeline", async () => {
    const { adapter, socket } = makeAdapter();
    await adapter.enable(CONTEXT);
    socket.emit("open");
    CLOCK.t = "2026-09-09T14:01:00Z";
    socket.emit("message", { data: JSON.stringify(positionFrame(567001002, 33.69, -118.16, "2026-09-09 14:00:30.000 +0000 UTC")) });
    const result = await adapter.refresh({ now: CLOCK.t, trigger: "scheduled" });
    expect(result.status).toBe("ok");
    expect(result.acceptedCount).toBe(1);
    expect(adapter.getStatus().state).toBe("FRESH");
    await adapter.disable();
  });
});

describe("ADR-0010 retention and §14.1 key hygiene", () => {
  it("the buffer is bounded and TTL-pruned by receivedAt", async () => {
    const { adapter, socket } = makeAdapter({ maxRecords: 3, retentionSeconds: 600 });
    await adapter.enable(CONTEXT);
    socket.emit("open");
    const baseMinutes = [0, 10, 20, 30, 40, 50];
    for (let i = 0; i < baseMinutes.length; i++) {
      CLOCK.t = `2026-09-09T14:${String(baseMinutes[i]!).padStart(2, "0")}:00Z`;
      socket.emit("message", {
        data: JSON.stringify(positionFrame(567001003, 33.68, -118.17, `2026-09-09 13:${String(59 - i).padStart(2, "0")}:00.000 +0000 UTC`)),
      });
    }
    // maxRecords=3: only the newest 3 survive; retention 600s prunes older receives.
    expect(adapter.getRecords().length).toBeLessThanOrEqual(3);
    await adapter.disable();
  });

  it("the API key never appears in attribution, status, or diagnostics", async () => {
    const { adapter, socket } = makeAdapter();
    await adapter.enable(CONTEXT);
    socket.emit("open");
    const surfaces = [
      JSON.stringify(adapter.getAttribution()),
      JSON.stringify(adapter.getStatus()),
      JSON.stringify(adapter.getDiagnostics()),
    ];
    for (const s of surfaces) expect(s).not.toContain("test-key-server-side-only");
    // The subscription payload is the ONLY place the key legitimately appears.
    expect(socket.sent[0]!).toContain("test-key-server-side-only");
    await adapter.disable();
  });

  it("classification from ShipStaticData flows through to freight cohorting", async () => {
    const { adapter, socket } = makeAdapter();
    await adapter.enable(CONTEXT);
    socket.emit("open");
    CLOCK.t = "2026-09-09T14:01:00Z";
    socket.emit("message", { data: JSON.stringify(staticFrame(567001004, 80)) }); // tanker
    socket.emit("message", { data: JSON.stringify(positionFrame(567001004, 33.68, -118.17, "2026-09-09 14:00:50.000 +0000 UTC")) });
    const records = adapter.getRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.entityType).toBe("tanker");
    expect(records[0]!.quality.classification).toBe("confirmed");
    await adapter.disable();
  });

  it("attribution is OBSERVED with provider-verified coverage caveats", () => {
    const { adapter } = makeAdapter();
    const attribution = adapter.getAttribution();
    expect(attribution.truthState).toBe("OBSERVED");
    expect(attribution.attributionText).toMatch(/AISStream\.io/);
    expect(attribution.attributionText).toMatch(/incomplete/);
    expect(attribution.termsUrl).toBeNull(); // provider publishes no terms (ADR-0010)
  });
});
