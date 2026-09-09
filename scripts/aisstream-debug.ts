/**
 * AISStream debug probe (LOCAL ONLY — real key + network).
 * Logs ONLY message-type metadata: top-level keys and MessageType values.
 * NEVER logs payload content, coordinates, MMSIs, or the API key (ADR-0010, §14.1).
 * Usage: AISSTREAM_API_KEY=<key> npm run debug  (SMOKE_SECONDS=60 default)
 */

const key = process.env["AISSTREAM_API_KEY"];
if (!key) {
  console.error("AISSTREAM_API_KEY is not set.");
  process.exit(1);
}
const durationSeconds = Number(process.env["SMOKE_SECONDS"] ?? 60);

const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
// AISStream sends BINARY frames carrying UTF-8 JSON; request ArrayBuffers so
// we can decode instead of receiving Blobs (whose String() is "[object Blob]").
ws.binaryType = "arraybuffer";

function decodeFrame(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data instanceof Blob) return "(blob received)"; // should not happen with binaryType=arraybuffer
  return `(unknown data type: ${typeof data})`;
}

const counts = new Map<string, number>();
let framesSeen = 0;

// Empirical box-order probe: BOX_ORDER=lonlat|latlon (the AISStream example is
// symmetric, so it cannot disambiguate order — this must be settled by data).
const boxOrder = (process.env["BOX_ORDER"] ?? "lonlat") as "lonlat" | "latlon";
const useFilter = (process.env["FILTER"] ?? "1") !== "0";
const singaporeBox = { minLat: 1.04, minLon: 103.56, maxLat: 1.42, maxLon: 104.35 };
const rawBox = boxOrder === "lonlat"
  ? [[singaporeBox.minLon, singaporeBox.minLat], [singaporeBox.maxLon, singaporeBox.maxLat]]
  : [[singaporeBox.minLat, singaporeBox.minLon], [singaporeBox.maxLat, singaporeBox.maxLon]];

ws.addEventListener("open", () => {
  console.log(`socket open; sending subscription (BOX_ORDER=${boxOrder}, FILTER=${useFilter})...`);
  ws.send(JSON.stringify({
    APIkey: key,
    BoundingBoxes: [rawBox],
    ...(useFilter ? { FilterMessageTypes: ["PositionReport", "ShipStaticData", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "StaticDataReport"] } : {}),
  }));
});

ws.addEventListener("message", (event) => {
  framesSeen += 1;
  const raw = decodeFrame(event.data);
  if (framesSeen <= 20) {
    // Metadata only: top-level keys and MessageType. No payload content.
    try {
      const parsed = JSON.parse(raw);
      const keys = Object.keys(parsed).join(",");
      const msgType = typeof parsed["MessageType"] === "string" ? parsed["MessageType"] : "(no MessageType)";
      console.log(`frame ${framesSeen}: keys=[${keys}] MessageType=${msgType}`);
      if (msgType === "(no MessageType)" && framesSeen <= 5) {
        // Error/unknown shapes: log sanitized server text only (no key material).
        const text = raw.replace(new RegExp(key, "g"), "<REDACTED>");
        console.log(`  raw (sanitized): ${text.slice(0, 300)}`);
      }
    } catch {
      console.log(`frame ${framesSeen}: <unparseable, length ${raw.length}>`);
    }
  }
  counts.set("total", (counts.get("total") ?? 0) + 1);
});

ws.addEventListener("error", (e) => console.log("socket error (sanitized):", String(e).slice(0, 200)));
ws.addEventListener("close", (e) => console.log(`socket close (code=${(e as CloseEvent).code ?? "n/a"})`));

setTimeout(() => {
  console.log("--- probe summary ---");
  console.log("frames seen:", framesSeen);
  ws.close();
  process.exit(0);
}, durationSeconds * 1000);
