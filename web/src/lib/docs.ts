import { marked } from "marked";

const MODS = import.meta.glob<string>("../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export type DocMeta = { slug: string; title: string; order: number };

function parseMeta(raw: string): { title?: string; order?: number } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [k, ...rest] = line.split(":");
    if (k && rest.length) meta[k.trim()] = rest.join(":").trim();
  }
  return { title: meta.title, order: Number(meta.order) || undefined };
}

const slugOf = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");

export function listDocs(): DocMeta[] {
  return Object.entries(MODS)
    .map(([p, raw]) => {
      const slug = slugOf(p);
      const meta = parseMeta(raw);
      return { slug, title: meta.title ?? slug, order: meta.order ?? 999 };
    })
    .sort((a, b) => a.order - b.order);
}

export function getDoc(slug: string): { title: string; html: string } | null {
  const raw = Object.entries(MODS).find(
    ([p]) => slugOf(p) === slug,
  )?.[1] as string | undefined;
  if (!raw) return null;
  const meta = parseMeta(raw);
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const html = marked.parse(body) as string;
  return { title: meta.title ?? slug, html };
}
