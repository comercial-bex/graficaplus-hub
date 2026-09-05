import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, Download, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  carregarPropsOrcamento,
  carregarPropsOrcamentoComCustos,
  carregarPropsOrcamento3d,
  carregarPropsOS,
  renderPDFBlob,
  salvarERegistrarPDF,
} from "./generate";
import type { DocumentoPDFProps } from "./DocumentoPDF";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipo: "orcamento" | "os" | "orcamento_3d";
  referencia_id: string;
  mostrarValores?: boolean;
  /** Via interna: anexa a base de custo (tarifas e custo real por peça). */
  comCustos?: boolean;
};

export function PDFPreviewDialog({ open, onOpenChange, tipo, referencia_id, mostrarValores = true, comCustos = false }: Props) {
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
          ? comCustos
            ? await carregarPropsOrcamentoComCustos(referencia_id)
            : await carregarPropsOrcamento(referencia_id, mostrarValores)
          : tipo === "orcamento_3d"
            ? await carregarPropsOrcamento3d(referencia_id, mostrarValores)
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
  }, [open, tipo, referencia_id, mostrarValores, comCustos, onOpenChange]);

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
        variante: comCustos ? "custos" : mostrarValores ? "cliente" : "producao",
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
            Preview · {tipo === "os" ? "OS" : tipo === "orcamento_3d" ? "Orçamento 3D" : "Orçamento"}
            {comCustos ? " (uso interno — com custos)" : !mostrarValores ? " (Produção)" : ""}
          </DialogTitle>
        </DialogHeader>
        {/* Documento sai para o cliente: faltar CNPJ ou endereço no cabeçalho é o
            tipo de coisa que ninguém percebe até o cliente perguntar. */}
        {props && !loading && dadosDaEmpresaFaltando(props.empresa).length > 0 && (
          <div className="mx-4 mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              Este documento vai sair sem{" "}
              <strong>{dadosDaEmpresaFaltando(props.empresa).join(", ")}</strong>. Preencha em
              Configurações › Dados da empresa.
            </div>
          </div>
        )}
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

/**
 * O que falta no cabeçalho do emissor.
 *
 * empresa_config nasce como uma linha de rascunho só com o nome — sem isto, o
 * orçamento chega ao cliente sem CNPJ e sem endereço e nada avisa.
 */
function dadosDaEmpresaFaltando(empresa: DocumentoPDFProps["empresa"]) {
  const faltando: string[] = [];
  if (!empresa.cnpj) faltando.push("CNPJ");
  if (!empresa.endereco) faltando.push("endereço");
  if (!empresa.telefones) faltando.push("telefone");
  return faltando;
}
