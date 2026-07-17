import { RatingsCard } from "../tasks/RatingsCard";

export default async function ProjectRatingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ratings</h1>
        <p className="text-white/60 text-sm mt-1">
          Match star ratings (1–5). Written comments live under Feedback — a submission can
          include both, but analytics here only count stars.
        </p>
      </div>
      <RatingsCard projectId={id} />
    </div>
  );
}
