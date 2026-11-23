import { ImageResponse } from "next/og";

export const alt = "Steward — pre-submission review for grant invoices. Synthetic demo card.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#040503";
const BONE = "#efece6";
const MUTED = "#aaa69e";
const CARD_INK = "#16150f";
const CARD_MUTED = "#5d5950";
const PEN = "#d8392b";
const GREEN = "#0b6b4c";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: BG,
          padding: 64,
          fontFamily: "system-ui",
          color: BONE,
        }}
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 18, letterSpacing: 3, color: MUTED }}>
            <div style={{ width: 36, height: 1, background: MUTED }} />
            PRE-SUBMISSION REVIEW FOR GRANT INVOICES
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 300, lineHeight: 1.02, letterSpacing: -3 }}>
            <span>Grant invoices</span>
            <span>that don&rsquo;t</span>
            <span style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}>come back.</span>
          </div>
          <div style={{ fontSize: 20, color: MUTED }}>Steward · Synthetic demo data · Built at Cal Hacks 13.0</div>
        </div>
        <div
          style={{
            width: 430,
            alignSelf: "center",
            display: "flex",
            flexDirection: "column",
            background: BONE,
            color: CARD_INK,
            borderRadius: 20,
            padding: 32,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: CARD_MUTED }}>
            <span>City contract FS-27-0412</span>
            <span>Synthetic data</span>
          </div>
          <div style={{ fontSize: 21, fontWeight: 600, marginTop: 4 }}>October 2026 invoice</div>
          <div style={{ fontSize: 15, color: CARD_MUTED, marginTop: 24 }}>Claimable this month</div>
          <div style={{ fontSize: 52, fontWeight: 300, letterSpacing: -2 }}>$17,872.21</div>
          <div style={{ fontSize: 17, fontWeight: 600, marginTop: 16 }}>7 of 9 checks passed</div>
          <div style={{ display: "flex", gap: 5, marginTop: 10 }}>
            {Array.from({ length: 9 }, (_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 7,
                  borderRadius: 4,
                  background: i < 7 ? GREEN : "transparent",
                  border: i < 7 ? "none" : `2px solid ${PEN}`,
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22, fontSize: 17 }}>
            <span>Amazon ledger</span>
            <span style={{ display: "flex", position: "relative", color: CARD_MUTED }}>
              $48.36
              <div style={{ position: "absolute", left: -3, right: -3, top: 11, height: 3, background: PEN, borderRadius: 2 }} />
            </span>
            <span>· receipt $48.37</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
