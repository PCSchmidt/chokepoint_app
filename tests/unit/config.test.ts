/**
 * Configuration tests (CHOKEPOINT-PLAN.md §4.3): the MVP chokepoint set, the
 * placeholder-geometry guard, and the source registry admission state.
 */

import { describe, expect, it } from "vitest";
import {
  assertUsableGeofence,
  CHOKEPOINT_REGISTRY,
  getChokepoint,
  isPlaceholder,
} from "../../src/config/chokepoints";
import { admittedSources, SOURCE_REGISTRY } from "../../src/config/sourceRegistry";

describe("chokepoint registry", () => {
  it("contains exactly the three MVP chokepoints (§2.1)", () => {
    expect(CHOKEPOINT_REGISTRY.map((c) => c.id)).toEqual([
      "long-beach-approach",
      "singapore-malacca-approach",
      "suez-canal-approaches",
    ]);
  });

  it("exposes lookup by stable id", () => {
    const lb = getChokepoint("long-beach-approach");
    expect(lb?.name).toBe("Los Angeles / Long Beach");
    expect(getChokepoint("nonexistent")).toBeUndefined();
  });

  it("every profile is versioned and carries limitations", () => {
    for (const c of CHOKEPOINT_REGISTRY) {
      expect(c.configVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(c.limitations.length).toBeGreaterThan(0);
      expect(c.geofences.length).toBeGreaterThan(0);
      for (const g of c.geofences) {
        expect(g.geometryVersion).toBeTruthy();
        expect(g.coordinateReference).toBe("EPSG:4326");
      }
    }
  });

  it("all current geofences are flagged placeholder and BLOCKED from use", () => {
    for (const c of CHOKEPOINT_REGISTRY) {
      for (const g of c.geofences) {
        expect(isPlaceholder(g)).toBe(true);
        expect(g.geometryStatus).toBe("placeholder");
        expect(() => assertUsableGeofence(g)).toThrow(/placeholder/);
      }
    }
  });

  it("reviewed geofences would pass the guard (guard contract test)", () => {
    const reviewed = { ...CHOKEPOINT_REGISTRY[0]!.geofences[0]!, geometryStatus: "reviewed" as const, reviewOwner: "test" };
    expect(() => assertUsableGeofence(reviewed)).not.toThrow();
  });
});

describe("source registry", () => {
  it("admits exactly the AISStream pair (ADR-0010) and defers everything else", () => {
    expect(admittedSources().map((s) => s.sourceId).sort()).toEqual(["ais-classification", "aisstream"]);
    for (const s of SOURCE_REGISTRY) {
      if (s.sourceId === "aisstream" || s.sourceId === "ais-classification") {
        expect(s.admissionStatus).toBe("admitted");
        expect(s.termsDecision).toBe("approved");
      } else {
        expect(s.termsDecision).toBe("TBD");
        expect(s.admissionStatus).not.toBe("admitted");
      }
    }
  });

  it("the admitted source is not keyless (server-side key required, §14.1)", () => {
    const ais = SOURCE_REGISTRY.find((s) => s.sourceId === "aisstream")!;
    expect(ais.keylessUsable).toBe(false);
  });
});
