import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, Download, X, ExternalLink } from "lucide-react";
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
import { PaginasDoPDF } from "./PaginasDoPDF";
import { mensagemErro } from "@/lib/erros";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipo: "orcamento" | "os" | "orcamento_3d";
  referencia_id: string;
  mostrarValores?: boolean;
  /** Via interna: anexa a base de custo (tarifas e custo real por peça). */
  comCustos?: boolean;
};

/**
 * Prévia do documento antes de baixar e registrar no histórico.
 *
 * Até 05/10/2026 a prévia era um `<iframe src="blob:…">`, que depende do leitor
 * de PDF do navegador. Dentro da prévia do Lovable (iframe dentro de iframe),
 * no Android e no iPhone isso fica BRANCO — foi o que o dono viu nas duas
 * vias. Agora cada página é desenhada num canvas pelo pdf.js: o mesmo resultado
 * em qualquer navegador, ajustado à largura da tela, com rolagem.
 */
export function PDFPreviewDialog({
  open,
  onOpenChange,
  tipo,
  referencia_id,
  mostrarValores = true,
  comCustos = false,
}: Props) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [props, setProps] = useState<DocumentoPDFProps | null>(null);
  const [saving, setSaving] = useState(false);
  // As telas passam `onOpenChange` como função nova a cada render (a da OS é
  // `(o) => !o && …`). Na lista de dependências, cada render da tela montava o
  // PDF de novo — e agora isso inclui baixar e converter todas as artes.
  const aoMudar = useRef(onOpenChange);
  useEffect(() => {
    aoMudar.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setBlob(null);
    setProps(null);
    (async () => {
      try {
        const p =
          tipo === "orcamento"
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
      } catch (e: unknown) {
        if (cancelled) return;
        toast.error(mensagemErro(e, "Falha ao gerar o documento"));
        aoMudar.current(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tipo, referencia_id, mostrarValores, comCustos]);

  // A URL do arquivo vive enquanto o documento está na tela. Quem abriu em
  // outra aba ainda pode estar lendo: ela só é liberada um minuto depois.
  useEffect(() => {
    if (!blob) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => {
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
  }, [blob]);

  async function baixarESalvar() {
    if (!blob || !props || !blobUrl) return;
    setSaving(true);
    try {
      const { filename } = await salvarERegistrarPDF({
        blob,
        tipo,
        referencia_id,
        numero: props.numero,
        variante: comCustos ? "custos" : mostrarValores ? "cliente" : "producao",
      });
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("PDF salvo no histórico");
      qc.invalidateQueries({ queryKey: ["documentos-gerados", tipo, referencia_id] });
    } catch (e: unknown) {
      toast.error(mensagemErro(e, "Falha ao salvar"));
    } finally {
      setSaving(false);
    }
  }

  const faltando = props ? dadosDaEmpresaFaltando(props.empresa) : [];
  const nomeDoTipo = tipo === "os" ? "OS" : tipo === "orcamento_3d" ? "Orçamento 3D" : "Orçamento";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b p-4 pr-12 text-left">
          <DialogTitle className="text-base sm:text-lg">
            {nomeDoTipo}
            {props ? ` nº ${props.numero}` : ""}
            {comCustos ? " · uso interno, com custos" : !mostrarValores ? " · via de produção" : ""}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Prévia do documento em PDF, página por página.
          </DialogDescription>
        </DialogHeader>
        {/* Documento sai para o cliente: faltar CNPJ ou endereço no cabeçalho é o
            tipo de coisa que ninguém percebe até o cliente perguntar. */}
        {props && !loading && faltando.length > 0 && (
          <div className="mx-3 mt-3 flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm sm:mx-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
            <div>
              Este documento vai sair sem <strong>{faltando.join(", ")}</strong>. Preencha em
              Configurações › Dados da empresa.
            </div>
          </div>
        )}
        <div className="relative min-h-0 flex-1 bg-muted">
          {loading || !blob ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Montando o documento…
              </div>
            </div>
          ) : (
            <PaginasDoPDF blob={blob} />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t p-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="mr-1 h-4 w-4" /> Fechar
          </Button>
          {/* Link de verdade (não window.open): o toque do usuário abre a aba
              mesmo onde pop-up é bloqueado, e o leitor do aparelho assume. */}
          <Button variant="outline" asChild disabled={!blobUrl}>
            <a
              href={blobUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!blobUrl}
              className={!blobUrl ? "pointer-events-none opacity-50" : undefined}
            >
              <ExternalLink className="mr-1 h-4 w-4" /> Abrir em nova aba
            </a>
          </Button>
          <Button onClick={baixarESalvar} disabled={!blob || saving}>
            {saving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            Baixar e salvar
          </Button>
        </div>
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
