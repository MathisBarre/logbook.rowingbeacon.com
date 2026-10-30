import { RefObject, useEffect, useState } from "react";

/**
 * True once the element has been on screen (plan 1.3: a card that is off
 * screen does not query). It stays true afterwards, so scrolling back and
 * forth does not queue the same query again. Without IntersectionObserver
 * every element counts as visible.
 */
export const useInView = (
  ref: RefObject<Element>,
  rootMargin = "200px"
): boolean => {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin, seen]);
  return seen;
};
