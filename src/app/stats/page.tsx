import StatsView from "@/components/StatsView";
import { Suspense } from "react";

export default function StatsPage() {
  return (
    <Suspense fallback={null}>
      <StatsView />
    </Suspense>
  );
}
