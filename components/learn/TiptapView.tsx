'use client';

import { useEditor, EditorContent, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';

export function TiptapView({ content }: { content: JSONContent | null }) {
  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ HTMLAttributes: { class: 'text-[#5a67fa] underline' } }), Image],
    content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-invert max-w-none [&_p]:my-3 [&_h1]:text-3xl [&_h2]:text-2xl [&_h3]:text-xl [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-black/40 [&_pre]:p-3 [&_pre]:rounded [&_a]:underline',
      },
    },
  });

  if (!editor) return null;
  return <EditorContent editor={editor} />;
}
