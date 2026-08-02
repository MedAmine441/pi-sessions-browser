import SessionsGrid from "@/components/SessionsGrid";

export default async function DatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return <SessionsGrid date={decodeURIComponent(date)} />;
}
