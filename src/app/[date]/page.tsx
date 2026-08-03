import SessionsGrid from "@/components/SessionsGrid";
import { Suspense } from "react";

export default async function DatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return (
    <Suspense fallback={null}>
      <SessionsGrid date={decodeURIComponent(date)} />
    </Suspense>
  );
}
