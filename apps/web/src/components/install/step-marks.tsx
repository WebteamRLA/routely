/** The numbered circle and the line joining it to the next step, in the install dialogs. */

export function Connector() {
  return (
    <span
      aria-hidden="true"
      className="absolute top-[30px] -bottom-3.5 left-3 w-0.5 rounded-sm bg-[#F3F4F6]"
    />
  );
}

export function StepNum({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="relative z-[1] inline-flex size-[26px] flex-[0_0_26px] items-center justify-center rounded-full border-[1.5px] border-[#D1D5DB] bg-white text-[13px] font-semibold text-[#374151]"
    >
      {n}
    </span>
  );
}
