"use client";

/**
 * Last-resort boundary for failures in the root layout itself. It replaces the whole
 * document, so it must render its own `<html>` and `<body>` and cannot rely on the app's
 * providers, fonts or shared components — hence the design's colours inlined as literals.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "Manrope, system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
          padding: "20px",
          background: "#F5F6F9",
          color: "#0F1B35",
        }}
      >
        <main
          role="alert"
          style={{
            width: "min(520px, 100%)",
            boxSizing: "border-box",
            background: "#FFFFFF",
            border: "1px solid #F3C9C0",
            borderRadius: "8px",
            padding: "32px 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "8px",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#B4361F",
            }}
          >
            Couldn&rsquo;t load
          </div>
          <h1
            style={{
              fontFamily: "Sora, system-ui, sans-serif",
              fontSize: "18px",
              fontWeight: 600,
              margin: 0,
            }}
          >
            Routely is unavailable
          </h1>
          <p style={{ color: "#5B6579", margin: 0, fontSize: "14px", lineHeight: 1.55 }}>
            An unexpected error stopped the application from loading.
          </p>
          {error.digest ? (
            <p
              style={{
                color: "#5B6579",
                margin: 0,
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "6px",
              height: "36px",
              padding: "0 14px",
              borderRadius: "6px",
              border: "1px solid #0A1633",
              background: "#0A1633",
              color: "#FFFFFF",
              cursor: "pointer",
              font: "inherit",
              fontSize: "13.5px",
              fontWeight: 700,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
