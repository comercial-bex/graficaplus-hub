import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Download, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  carregarPropsOrcamento,
  carregarPropsOS,
  renderPDFBlob,
  salvarERegistrarPDF,
} from "./generate";
import type { DocumentoPDFProps } from "./DocumentoPDF";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipo: "orcamento" | "os";
  referencia_id: string;
  mostrarValores?: boolean;
};

export function PDFPreviewDialog({ open, onOpenChange, tipo, referencia_id, mostrarValores = true }: Props) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [props, setProps] = useState<DocumentoPDFProps | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setBlobUrl(null);
    (async () => {
      try {
        const p = tipo === "orcamento"
          ? await carregarPropsOrcamento(referencia_id, mostrarValores)
          : await carregarPropsOS(referencia_id, mostrarValores);
        const b = await renderPDFBlob(p);
        if (cancelled) return;
        setProps(p);
        setBlob(b);
        setBlobUrl(URL.createObjectURL(b));
      } catch (e: any) {
        toast.error(e.message ?? "Falha ao gerar preview");
        onOpenChange(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tipo, referencia_id, mostrarValores, onOpenChange]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  async function baixarESalvar() {
    if (!blob || !props) return;
    setSaving(true);
    try {
      const { filename } = await salvarERegistrarPDF({
        blob, tipo, referencia_id, numero: props.numero,
        variante: mostrarValores ? "cliente" : "producao",
      });
      const a = document.createElement("a");
      a.href = blobUrl!;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("PDF salvo no histórico");
      qc.invalidateQueries({ queryKey: ["documentos-gerados", tipo, referencia_id] });
    } catch (e: any) {
      toast.error(e.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>
            Preview · {tipo === "orcamento" ? "Orçamento" : "OS"}
            {!mostrarValores && " (Produção)"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 bg-muted relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground">
              <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Gerando preview...</div>
            </div>
          )}
          {blobUrl && (
            <iframe src={blobUrl} title="PDF Preview" className="w-full h-full border-0" />
          )}
        </div>
        <DialogFooter className="p-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-1" /> Fechar
          </Button>
          <Button onClick={baixarESalvar} disabled={!blob || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            Baixar e salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
