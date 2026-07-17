import { TasksManager } from "./TasksManager";

export default async function ProjectTasksPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <p className="text-white/60 text-sm mt-1">
          Inbox and milestones for this project. Player write-ups are under Feedback; stars under
          Ratings.
        </p>
      </div>
      <TasksManager projectId={id} />
    </div>
  );
}
