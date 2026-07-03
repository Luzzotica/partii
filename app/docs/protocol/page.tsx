import ReactMarkdown from "react-markdown";
import { PROTOCOL_MD } from "@/content/protocolDoc";

export const metadata = { title: "Lobbii Protocol — wire spec" };

export default function ProtocolPage() {
  return (
    <article
      className="
        [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:mb-4
        [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-white/10 [&_h2]:pb-2
        [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2
        [&_p]:text-white/75 [&_p]:leading-relaxed [&_p]:my-3
        [&_li]:text-white/75 [&_li]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3
        [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-emerald-200/90 [&_code]:bg-white/[0.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
        [&_pre]:bg-black/40 [&_pre]:border [&_pre]:border-white/10 [&_pre]:rounded-xl [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:my-4
        [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-white/80
        [&_table]:w-full [&_table]:text-sm [&_table]:my-4
        [&_th]:text-left [&_th]:text-white/60 [&_th]:border-b [&_th]:border-white/10 [&_th]:p-2
        [&_td]:p-2 [&_td]:border-b [&_td]:border-white/5 [&_td]:text-white/75
        [&_a]:text-blue-300 [&_a]:hover:underline
      "
    >
      <ReactMarkdown>{PROTOCOL_MD}</ReactMarkdown>
    </article>
  );
}
