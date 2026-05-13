'use client';

import { useEditor, EditorContent, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { useEffect } from 'react';

type Props = {
  value: JSONContent | null;
  onChange: (json: JSONContent) => void;
  placeholder?: string;
};

export function TiptapEditor({ value, onChange }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-[#5a67fa] underline' } }),
      Image,
    ],
    content: value ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-invert max-w-none min-h-[300px] px-4 py-3 focus:outline-none [&_p]:my-2 [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-black/40 [&_pre]:p-3 [&_pre]:rounded',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });

  // Sync external value changes (e.g. after save+refetch)
  useEffect(() => {
    if (!editor || !value) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(value);
    if (current !== next) editor.commands.setContent(value as JSONContent, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;

  const btn = (active: boolean) =>
    `px-2 py-1 text-xs rounded border ${active ? 'bg-white/15 border-white/30' : 'border-white/10 hover:bg-white/5'}`;

  return (
    <div className="rounded-lg border border-white/10 bg-black/20">
      <div className="flex flex-wrap gap-1 px-2 py-2 border-b border-white/10">
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive('bold'))}>B</button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive('italic'))}><em>I</em></button>
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive('heading', { level: 2 }))}>H2</button>
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btn(editor.isActive('heading', { level: 3 }))}>H3</button>
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))}>• List</button>
        <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive('orderedList'))}>1. List</button>
        <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btn(editor.isActive('blockquote'))}>&ldquo;&rdquo;</button>
        <button type="button" onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={btn(editor.isActive('codeBlock'))}>{'</>'}</button>
        <button
          type="button"
          onClick={() => {
            const url = window.prompt('Link URL');
            if (url) editor.chain().focus().setLink({ href: url }).run();
            else editor.chain().focus().unsetLink().run();
          }}
          className={btn(editor.isActive('link'))}
        >
          Link
        </button>
        <button
          type="button"
          onClick={() => {
            const url = window.prompt('Image URL');
            if (url) editor.chain().focus().setImage({ src: url }).run();
          }}
          className={btn(false)}
        >
          Image
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
