import DateTimeline from "@/components/DateTimeline";
import { Suspense } from "react";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <DateTimeline />
    </Suspense>
  );
}
