import type { Shot } from "@/lib/guide-shots";

/**
 * A screenshot in a guide: framed like the app's cards, at its natural aspect ratio (the stored
 * size reserves the space before it loads), never wider than the column. Lazy, so a guide's
 * images load as the reader reaches them. A dialog crop already has its own border and rounded
 * (transparent) corners, so it gets only a shadow that follows that outline — a second frame drew
 * mismatched corners around it.
 */
export function Screenshot({ shot, caption }: { shot: Shot; caption?: string | undefined }) {
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div
        className={
          shot.dialog
            ? "w-fit max-w-full drop-shadow-[0_4px_12px_#11182714]"
            : "w-fit max-w-full overflow-hidden rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] shadow-[0_1px_2px_#1118270D]"
        }
      >
        {/* Static, pre-sized images from /public — next/image's optimiser adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shot.src}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          loading="lazy"
          decoding="async"
          className="block h-auto max-w-full"
          style={{ width: Math.min(shot.width / 2, 560) }}
        />
      </div>
      {caption ? (
        <figcaption className="text-[13px] leading-[19px] text-[#6B7280]">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
