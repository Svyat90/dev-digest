import { lineDiff } from "@/lib/line-diff";
import { s } from "./styles";

const MARKER = { add: "+", remove: "−", equal: " " } as const;

/** Line diff of two texts. Text is a React child — never HTML or markdown. */
export function DiffLines({ before, after }: { before: string; after: string }) {
  const ops = lineDiff(before, after);
  return (
    <div style={s.diffBody}>
      {ops.map((op, i) => (
        <div key={i} style={s.diffLine(op.type)}>
          <span style={s.diffMarker}>{MARKER[op.type]}</span>
          <span className="mono" style={s.diffText}>
            {op.text.length > 0 ? op.text : " "}
          </span>
        </div>
      ))}
    </div>
  );
}
