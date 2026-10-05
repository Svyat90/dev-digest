import { s } from "./styles";

/** Document type as text (never colour alone). */
export function DocTypeTag({ type }: { type: string | null }) {
  if (!type) return null;
  return <span style={s.tag}>{type}</span>;
}
