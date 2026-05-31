import { useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface LuceneQueryInputProps {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tokenizeLucene(text: string): string {
  const re =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:AND|OR|NOT|TO)\b|[\w.*][\w.*]*(?=\s*:))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const parts: string[] = [];

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, match.index)));
    }

    const val = match[0];
    const escaped = escapeHtml(val);

    if (val.startsWith('"') || val.startsWith("'")) {
      parts.push(`<span class="lq-string">${escaped}</span>`);
    } else if (/^(AND|OR|NOT|TO)$/.test(val)) {
      parts.push(`<span class="lq-op">${escaped}</span>`);
    } else {
      parts.push(`<span class="lq-field">${escaped}</span>`);
    }

    lastIndex = re.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)));
  }

  return parts.join("");
}

function getCaretCharOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.endContainer, range.endOffset);
  return preRange.toString().length;
}

function setCaretCharOffset(el: HTMLElement, targetOffset: number): void {
  const sel = window.getSelection();
  if (!sel) return;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = targetOffset;
  let node: Text | null = null;
  let offset = 0;

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const len = textNode.length;
    if (remaining <= len) {
      node = textNode;
      offset = remaining;
      break;
    }
    remaining -= len;
  }

  if (!node && el.lastChild) {
    const walker2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (walker2.nextNode()) {
      last = walker2.currentNode as Text;
    }
    if (last) {
      node = last;
      offset = last.length;
    }
  }

  if (node) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

export function LuceneQueryInput({
  value,
  onChange,
  onFocus,
  placeholder,
  className,
}: LuceneQueryInputProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;

    const currentText = el.innerText.replace(/\n/g, "");
    if (currentText === value) return;

    const caretPos = document.activeElement === el ? getCaretCharOffset(el) : -1;
    el.innerHTML = value ? tokenizeLucene(value) : "";
    if (caretPos >= 0) {
      setCaretCharOffset(el, caretPos);
    }
  }, [value]);

  const handleInput = useCallback(() => {
    if (isComposing.current) return;
    const el = divRef.current;
    if (!el) return;

    const caretPos = getCaretCharOffset(el);
    const plainText = el.innerText.replace(/\n/g, "");

    el.innerHTML = plainText ? tokenizeLucene(plainText) : "";
    setCaretCharOffset(el, caretPos);
    onChange(plainText);
  }, [onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const form = (e.currentTarget as HTMLElement).closest("form");
        if (form) form.requestSubmit();
      }
    },
    []
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain").replace(/\n/g, " ");
      const el = divRef.current;
      if (!el) return;

      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }

      const caretPos = getCaretCharOffset(el);
      const plainText = el.innerText.replace(/\n/g, "");
      el.innerHTML = plainText ? tokenizeLucene(plainText) : "";
      setCaretCharOffset(el, caretPos);
      onChange(plainText);
    },
    [onChange]
  );

  return (
    <div
      ref={divRef}
      role="textbox"
      aria-multiline="false"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onFocus={onFocus}
      onCompositionStart={() => { isComposing.current = true; }}
      onCompositionEnd={() => {
        isComposing.current = false;
        handleInput();
      }}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1",
        "text-sm font-mono shadow-xs outline-none",
        "focus-visible:ring-2 focus-visible:ring-neon/60 focus-visible:border-neon/40",
        "transition-[color,box-shadow] duration-150",
        "cursor-text whitespace-nowrap overflow-x-auto",
        "ring-offset-background",
        className
      )}
    />
  );
}
