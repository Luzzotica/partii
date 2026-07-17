import { TasksManager } from "./TasksManager";
import { RatingsCard } from "./RatingsCard";

export default async function ProjectTasksPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Ownership is enforced by the project layout.

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tasks &amp; Feedback</h1>
        <p className="text-white/60 text-sm mt-1">
          Inbox, milestones, and player ratings for this game.
        </p>
      </div>
      <RatingsCard projectId={id} />
      <TasksManager projectId={id} />
    </div>
  );
}
