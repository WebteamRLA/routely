import { cn } from "@/lib/utils";
import { armColor } from "@/lib/domain";

/** Project icon: detected favicon on white, or a letter tile. */
export function ProjectIcon({
  name,
  iconUrl,
  size = 28,
  tone = "navy",
  className,
}: {
  name: string;
  iconUrl?: string | null;
  size?: 28 | 34 | 44;
  tone?: "navy" | "light" | "white";
  className?: string;
}) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  const radius = size === 44 ? 8 : 6;
  if (iconUrl)
    return (
      <span
        role="img"
        aria-label=""
        className={cn(
          "block shrink-0 border border-border bg-white bg-center bg-no-repeat",
          className,
        )}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundImage: `url(${JSON.stringify(iconUrl)})`,
          backgroundSize: size === 44 ? "72%" : "76%",
        }}
      />
    );
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center font-heading font-bold",
        tone === "navy" && "bg-navy text-white",
        tone === "light" && "bg-divider text-navy",
        tone === "white" && "bg-white text-navy",
        className,
      )}
      style={{ width: size, height: size, borderRadius: radius, fontSize: size === 44 ? 19 : 13 }}
    >
      {letter}
    </span>
  );
}

export function initials(nameOrEmail: string): string {
  return nameOrEmail
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function Avatar({
  name,
  size = 32,
  tone = "navy",
  image,
}: {
  name: string;
  size?: 30 | 32;
  tone?: "navy" | "coral";
  image?: string | null;
}) {
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote avatar at 30px; next/image would need every host allow-listed.
      <img
        src={image}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full text-xs font-extrabold text-white",
        tone === "navy" ? "bg-navy" : "bg-coral",
      )}
      style={{ width: size, height: size }}
    >
      {initials(name)}
    </span>
  );
}

/** Arm colour swatch: dot 8 (r2), table 10 (r3), row 12 (r3). */
export function ArmSwatch({
  position = 0,
  size = 10,
  color,
  className,
}: {
  /** Arm position for the colour; or pass `color` directly. */
  position?: number;
  size?: 8 | 10 | 12;
  color?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0", className)}
      style={{
        width: size,
        height: size,
        borderRadius: size === 8 ? 2 : 3,
        background: color ?? armColor(position),
      }}
    />
  );
}

/** Arm tile: "C" for control (12px), "→"/letter for variants (13px), in the arm colour. */
export function ArmTile({
  position,
  glyph,
  size = 28,
}: {
  position: number;
  glyph?: string;
  size?: 28 | 32;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-md font-extrabold text-white",
        position === 0 ? "text-xs" : "text-[13px]",
      )}
      style={{ width: size, height: size, background: armColor(position) }}
    >
      {glyph ?? (position === 0 ? "C" : "→")}
    </span>
  );
}
