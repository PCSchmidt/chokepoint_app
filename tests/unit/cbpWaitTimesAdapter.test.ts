/**
 * CBP Border Wait Times adapter tests (ADR-0013, ADR-0015).
 *
 * Transport is INJECTED: every test uses a fake fetch over the archived real
 * CBP sample (research/sources/raw/cbp-bwt-sample-2026-09-10.json). No test
 * touches the network — CI stays keyless (§6.2).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CbpWaitTimesAdapter, type FetchLike } from "../../src/data/cbpWaitTimesAdapter";

const REAL_SAMPLE = readFileSync("research/sources/raw/cbp-bwt-sample-2026-09-10.json", "utf-8");
const NOW = "2026-09-10T13:00:00Z";

function fakeFetch(payload: string, status = 200): FetchLike {
  return async () => ({ status, ok: status < 400, text: async () => payload });
}

function adapter(fetchFn: FetchLike, opts: ConstructorParameters<typeof CbpWaitTimesAdapter>[0] = {}) {
  return new CbpWaitTimesAdapter({ fetchFn, nowFn: () => NOW, ...opts });
}

describe("CBP adapter (ADR-0013: keyless, OBSERVED facility metrics)", () => {
  it("ingests the REAL archived sample and exposes the El Paso crossings", async () => {
    const a = adapter(fakeFetch(REAL_SAMPLE), { portNumbers: ["240201", "240203"] });
    const result = await a.enable({ now: NOW, trigger: "startup" });
    expect(result.status).toBe("ok");
    expect(result.acceptedCount).toBe(2); // BOTA + Ysleta
    const metrics = a.getFacilityMetrics();
    expect(metrics.map((m) => m.facilityId).sort()).toEqual(["cbp:240201:bridge", "cbp:240203:ysleta"]);
    const bota = metrics.find((m) => m.facilityId === "cbp:240201:bridge")!;
    const wait = bota.measurements.find((x) => x.laneGroup === "commercial_vehicle" && x.metric === "wait_minutes");
    expect(wait?.value).toBe(3);
    expect(bota.providerUpdateLabel).toMatch(/MDT/); // verbatim lane update label
    a.destroy();
  });

  it("is keyless: no credential material in attribution or license (§14.1)", async () => {
    const a = adapter(fakeFetch(REAL_SAMPLE));
    await a.enable({ now: NOW, trigger: "startup" });
    expect(a.license.attributionText).toMatch(/U\.S\. Customs and Border Protection/);
    expect(JSON.stringify(a.getFacilityMetrics())).not.toMatch(/api[_-]?key/i);
    a.destroy();
  });

  it("empty payloads with no usable crossings report failure, never fabricate (§3.3)", async () => {
    const a = adapter(fakeFetch("[]"));
    const result = await a.enable({ now: NOW, trigger: "startup" });
    expect(result.status).toBe("failure");
    expect(result.acceptedCount).toBe(0);
    expect(a.getFacilityMetrics()).toHaveLength(0);
    a.destroy();
  });

  it("network failures record honest UNAVAILABLE health (no fabricated data)", async () => {
    const a = adapter(async () => {
      throw new Error("connection refused");
    });
    const result = await a.enable({ now: NOW, trigger: "startup" });
    expect(result.status).toBe("failure");
    expect(result.message).toMatch(/network error/);
    expect(a.getFacilityMetrics()).toHaveLength(0);
    const status = a.getStatus();
    expect(["UNAVAILABLE", "NEVER_ANSWERED"]).toContain(status.state);
    a.destroy();
  });

  it("HTTP error statuses degrade health honestly", async () => {
    const a = adapter(fakeFetch("gateway timeout", 504));
    const result = await a.enable({ now: NOW, trigger: "startup" });
    expect(result.status).toBe("failure");
    expect(result.message).toMatch(/504/);
    a.destroy();
  });

  it("malformed JSON is rejected, never partially ingested", async () => {
    const a = adapter(fakeFetch("{not json"));
    const result = await a.enable({ now: NOW, trigger: "startup" });
    expect(result.status).toBe("failure");
    expect(result.message).toMatch(/not JSON/);
    a.destroy();
  });

  it("unusable crossings (all lanes pending) are rejected, and healthy ones still ingest", async () => {
    const payload = JSON.stringify([
      {
        port_number: "240202",
        border: "Mexican Border",
        port_name: "El Paso",
        crossing_name: "Paso Del Norte (PDN)",
        hours: "24 hrs/day",
        date: "9/10/2026",
        time: "07:36:42",
        port_status: "Open",
        commercial_vehicle_lanes: {
          standard_lanes: { update_time: "", operational_status: "Update Pending", delay_minutes: "", lanes_open: "" },
        },
      },
      {
        port_number: "240201",
        border: "Mexican Border",
        port_name: "El Paso",
        crossing_name: "Bridge of the Americas (BOTA)",
        hours: "24 hrs/day",
        date: "9/10/2026",
        time: "07:36:42",
        port_status: "Open",
        commercial_vehicle_lanes: {
          standard_lanes: { update_time: "At 8:00 am MDT", operational_status: "no delay", delay_minutes: "3", lanes_open: "2" },
        },
      },
    ]);
    const a = adapter(fakeFetch(payload));
    const result = await a.enable({ now: NOW, trigger: "startup" });
    expect(result.status).toBe("partial"); // 1 usable, 1 unusable — honest partial
    expect(result.acceptedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    a.destroy();
  });

  it("disable clears records; the adapter reports disabled honestly", async () => {
    const a = adapter(fakeFetch(REAL_SAMPLE));
    await a.enable({ now: NOW, trigger: "startup" });
    expect(a.getFacilityMetrics().length).toBeGreaterThan(0);
    await a.disable();
    expect(a.getFacilityMetrics()).toHaveLength(0);
    const r = await a.refresh({ now: NOW, trigger: "manual" });
    expect(r.status).toBe("failure");
    expect(r.message).toMatch(/disabled/);
    a.destroy();
  });

  it("facilities report health honestly after polls", async () => {
    const a = adapter(fakeFetch(REAL_SAMPLE));
    await a.enable({ now: NOW, trigger: "startup" });
    const status = a.getStatus();
    expect(["FRESH", "STALE", "DEGRADED"]).toContain(status.state);
    a.destroy();
  });

});
