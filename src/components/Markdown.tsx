"use client";

import React from "react";

/**
 * Rendu Markdown léger, sans dépendance, calé sur le style des bulles de chat.
 * Gère : titres, gras, italique, code inline, liens, listes à puces et numérotées.
 * Les réponses des agents contiennent souvent du **gras** ou des listes : on les
 * affiche proprement au lieu de laisser les marqueurs bruts (**, -, 1., …).
 */

/* ------------------------- Parsing inline (gras, etc.) ------------------------- */

let keySeed = 0;
function nextKey() {
  return `md-${keySeed++}`;
}

/** Transforme une portion de texte en nœuds React (gras, italique, code, liens). */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Ordre important : le lien avant, puis code, gras (**/__), italique (*/_).
  const pattern =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*|__([^_]+)__)|(\*([^*]+)\*|_([^_]+)_)/g;

  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }

    if (match[1]) {
      // Lien [texte](url)
      nodes.push(
        <a
          key={nextKey()}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:opacity-80"
        >
          {match[2]}
        </a>
      );
    } else if (match[4]) {
      // Code inline `code`
      nodes.push(
        <code
          key={nextKey()}
          className="rounded bg-black/20 px-1 py-0.5 font-mono text-[0.85em]"
        >
          {match[5]}
        </code>
      );
    } else if (match[6]) {
      // Gras **texte** ou __texte__
      nodes.push(
        <strong key={nextKey()} className="font-semibold">
          {renderInline(match[7] ?? match[8] ?? "")}
        </strong>
      );
    } else if (match[9]) {
      // Italique *texte* ou _texte_
      nodes.push(
        <em key={nextKey()} className="italic">
          {renderInline(match[10] ?? match[11] ?? "")}
        </em>
      );
    }

    last = pattern.lastIndex;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes;
}

/* ----------------------------- Parsing par blocs ------------------------------ */

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const isUl = (l: string) => /^\s*[-*+]\s+/.test(l);
  const isOl = (l: string) => /^\s*\d+[.)]\s+/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      i++;
      continue;
    }

    if (isUl(line)) {
      const items: string[] = [];
      while (i < lines.length && isUl(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (isOl(line)) {
      const items: string[] = [];
      while (i < lines.length && isOl(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Paragraphe : on regroupe les lignes consécutives non vides / non-listes.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isUl(lines[i]) &&
      !isOl(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }

  return blocks;
}

/* --------------------------------- Composant ---------------------------------- */

export default function Markdown({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseBlocks(content ?? "");

  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "heading": {
            const cls =
              block.level <= 1
                ? "text-sm font-semibold"
                : "text-[13px] font-semibold";
            return (
              <p key={idx} className={cls}>
                {renderInline(block.text)}
              </p>
            );
          }
          case "ul":
            return (
              <ul key={idx} className="list-disc space-y-0.5 pl-4">
                {block.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={idx} className="list-decimal space-y-0.5 pl-4">
                {block.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            );
          case "p":
          default:
            return (
              <p key={idx} className="whitespace-pre-wrap">
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
