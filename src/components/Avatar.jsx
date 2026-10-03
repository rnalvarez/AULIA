import { useMemo } from "react";

export default function Avatar({ initials = "AI", size = 32 }) {
  const label = useMemo(
    () => String(initials || "AI").slice(0, 3).toUpperCase(),
    [initials]
  );

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        background: "linear-gradient(145deg, #a06020 0%, #5c2e08 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(10, Math.floor(size * 0.3)),
        fontWeight: 600,
        color: "#fde8c0",
        border: "1.5px solid #8a4a14",
        letterSpacing: "0.03em",
        userSelect: "none",
      }}
    >
      {label}
    </div>
  );
}
