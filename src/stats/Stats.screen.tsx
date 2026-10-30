import { lazy, Suspense } from "react";
import Loading from "../_common/components/Loading";

// The analytics hub is its own chunk: the boathouse never loads it.
const AnalyticsHub = lazy(() =>
  import("../analytics/AnalyticsHub").then((m) => ({ default: m.AnalyticsHub }))
);

// Fills <main> like every other screen: the hub's panel scrolls, not the
// window, so the header and the navigation bar stay on screen.
export const StatsScreen = () => (
  <div className="absolute inset-0 flex flex-col">
    <Suspense fallback={<Loading />}>
      <AnalyticsHub />
    </Suspense>
  </div>
);
