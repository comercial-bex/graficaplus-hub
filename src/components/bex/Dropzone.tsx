import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, X, ImageIcon, Loader2, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export type DropzoneStatus =
  | { kind: "idle" }
  | { kind: "loading"; label?: string }
  | { kind: "ok"; label: string }
  | { kind: "error"; label: string };

/**
 * Área de upload proeminente — drag & drop, clique ou colar do clipboard.
 * Mostra preview 200x200, nome do arquivo e badge de status.
 */
export function Dropzone({
  label,
  hint,
  file,
  onFile,
  status = { kind: "idle" },
  accent = "cyan",
  captureFromClipboard = true,
  accept = "image/*",
}: {
  label: string;
  hint?: string;
  file: File | null;
  onFile: (f: File | null) => void;
  status?: DropzoneStatus;
  accent?: "cyan" | "magenta" | "lime";
  captureFromClipboard?: boolean;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (!captureFromClipboard) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      if (!item) return;
      const f = item.getAsFile();
      if (f) onFile(f);
    },
    [captureFromClipboard, onFile],
  );

  useEffect(() => {
    if (!captureFromClipboard) return;
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [captureFromClipboard, handlePaste]);

  const accentClass = {
    cyan: "border-[color:var(--bex-cyan)]/50 bg-[color:var(--bex-cyan)]/5 hover:bg-[color:var(--bex-cyan)]/10",
    magenta:
      "border-[color:var(--bex-magenta)]/50 bg-[color:var(--bex-magenta)]/5 hover:bg-[color:var(--bex-magenta)]/10",
    lime: "border-[color:var(--bex-lime)]/50 bg-[color:var(--bex-lime)]/5 hover:bg-[color:var(--bex-lime)]/10",
  }[accent];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold">{label}</div>
        <StatusBadge status={status} />
      </div>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={cn(
          "relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition-all",
          accentClass,
          dragOver && "scale-[1.01] ring-2 ring-primary/40",
        )}
      >
        {preview ? (
          <div className="flex w-full items-center gap-3">
            <img
              src={preview}
              alt={file?.name ?? "preview"}
              className="h-24 w-24 rounded-lg object-cover border border-border"
            />
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium">{file?.name}</p>
              <p className="text-xs text-muted-foreground">
                {file ? `${(file.size / 1024).toFixed(0)} KB` : ""}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFile(null);
                }}
                className="mt-2 inline-flex items-center gap-1 text-xs text-[color:var(--bex-magenta)] hover:underline"
              >
                <X className="h-3 w-3" /> Remover
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-background/60">
              <Upload className="h-5 w-5" />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                Arraste, cole (Ctrl+V) ou <span className="underline">clique para escolher</span>
              </p>
              {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: DropzoneStatus }) {
  if (status.kind === "idle") return null;
  const map = {
    loading: {
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      cls: "border-[color:var(--bex-cyan)]/40 text-[color:var(--bex-cyan)] bg-[color:var(--bex-cyan)]/10",
    },
    ok: {
      icon: <Check className="h-3 w-3" />,
      cls: "border-[color:var(--bex-lime)]/40 text-[color:var(--bex-lime)] bg-[color:var(--bex-lime)]/10",
    },
    error: {
      icon: <AlertTriangle className="h-3 w-3" />,
      cls: "border-[color:var(--bex-magenta)]/40 text-[color:var(--bex-magenta)] bg-[color:var(--bex-magenta)]/10",
    },
  } as const;
  const s = map[status.kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        s.cls,
      )}
    >
      {s.icon}
      {"label" in status && status.label ? status.label : status.kind}
    </span>
  );
}

export { ImageIcon };
