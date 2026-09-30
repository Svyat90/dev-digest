import { useEffect, useRef, type RefObject } from "react";

/**
 * Publishes this header's rendered height as the `--pr-header-h` CSS custom
 * property on `targetRef`'s element (the PrDetailView root, not
 * `document.documentElement` — the var must not leak past this page).
 *
 * The header's height is NOT a constant: a long PR title wraps to a second
 * line and grows it. A sticky sibling further down the tree (the Smart Diff
 * role-group header, `DiffTab/styles.ts`) reads the var to stick right below
 * this header instead of guessing a hard-coded `top` offset that would sit
 * behind it.
 *
 * Kept in sync with a `ResizeObserver` (font load, wrap on resize, title
 * change) and cleaned up on unmount.
 */
export function useHeaderHeightVar(
  targetRef: RefObject<HTMLElement | null>,
  varName: string,
) {
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    const target = targetRef.current;
    if (!header || !target) return;

    const publish = () => target.style.setProperty(varName, `${header.offsetHeight}px`);
    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      target.style.removeProperty(varName);
    };
  }, [targetRef, varName]);

  return headerRef;
}
