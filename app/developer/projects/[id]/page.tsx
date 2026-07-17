import { redirect } from "next/navigation";

/** Project root always lands on Tasks (Partii Studio default). */
export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/developer/projects/${id}/tasks`);
}
