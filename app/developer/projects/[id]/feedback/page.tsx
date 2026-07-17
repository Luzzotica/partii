import { FeedbackManager } from "./FeedbackManager";

export default async function ProjectFeedbackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Feedback</h1>
        <p className="text-white/60 text-sm mt-1">
          Written notes from players. Star ratings are separate under{" "}
          <span className="text-white/80">Ratings</span>
          — if a note included stars, they show as a linked chip here.
        </p>
      </div>
      <FeedbackManager projectId={id} />
    </div>
  );
}
