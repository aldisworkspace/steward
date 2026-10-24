import { ImageResponse } from "next/og";

export const alt = "Steward — grants accountant demo card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#f7f5f0",
          padding: 48,
          fontFamily: "system-ui",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            paddingRight: 32,
          }}
        >
          <div style={{ fontSize: 52, fontWeight: 700, color: "#0e1b2c", lineHeight: 1.1 }}>
            The grants accountant that reads the contract.
          </div>
          <div style={{ marginTop: 20, fontSize: 22, color: "#4a5568", maxWidth: 520 }}>
            Catches clawback risk. Proposes the fix. You approve.
          </div>
        </div>
        <div
          style={{
            width: 420,
            border: "1px solid #d8dde6",
            borderRadius: 8,
            background: "#fff",
            padding: 28,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: "#0e1b2c" }}>The Black Cat SF</div>
          <div style={{ fontSize: 36, fontWeight: 700, color: "#0e1b2c", marginTop: 8 }}>−$482.50</div>
          <div style={{ fontSize: 14, color: "#4a5568", marginTop: 8 }}>Staff appreciation night</div>
          <div style={{ marginTop: 16, fontSize: 15, color: "#c0392b", textDecoration: "line-through" }}>
            Youth Pathways · Program supplies
          </div>
          <div style={{ marginTop: 8, fontSize: 15, fontWeight: 600, color: "#2d6a4f" }}>→ General funds</div>
          <div
            style={{
              marginTop: 16,
              borderLeft: "3px solid #c0392b",
              paddingLeft: 12,
              fontSize: 16,
              color: "#0e1b2c",
              fontStyle: "italic",
            }}
          >
            Staff meals and staff appreciation events are unallowable.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
