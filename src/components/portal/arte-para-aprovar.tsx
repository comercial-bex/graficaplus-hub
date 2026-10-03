import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ExternalLink, Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { mensagemErro } from "@/lib/erros";
import { formatarDia, tipoDePrevia, type ArteParaAprovar } from "@/domain/portal/painel-do-cliente";
import { abrirEmNovaAba, type ObterUrl } from "@/components/portal/abrir-arquivo";

/**
 * Uma arte que a equipe mandou para o cliente aprovar.
 *
 * A decisão passa pelo mesmo miolo do link de aprovação (/aprovar/$token):
 * grava a resposta, muda o arquivo e anda a OS. Antes, no portal por link,
 * "Aprovar arte" e "Reprovar arte" respondiam "Recebemos sua solicitação" e
 * não gravavam nada — o cliente achava que tinha aprovado e a produção nunca
 * ficava sabendo.
 */
export function ArteParaAprovarCartao({
  arte,
  osNumero,
  osTitulo,
  obterUrl,
  onDecidir,
}: {
  arte: ArteParaAprovar;
  osNumero: number;
  osTitulo: string | null;
  obterUrl: ObterUrl;
  /** Resolve só quando o banco gravou; erro sobe com o motivo. */
  onDecidir: (decisao: "aprovado" | "ajuste", comentario: string) => Promise<void>;
}) {
  const [pedindoAjuste, setPedindoAjuste] = useState(false);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const previa = tipoDePrevia(arte.mime, arte.nome);

  const imagem = useQuery({
    queryKey: ["portal-arte-previa", arte.arquivo_id],
    enabled: previa === "imagem",
    // A URL assinada vale 10 minutos: refaz antes de vencer na tela aberta.
    staleTime: 8 * 60 * 1000,
    queryFn: () => obterUrl({ tipo: "arquivo", id: arte.arquivo_id, nome: arte.nome, para: "ver" }),
    retry: false,
  });

  async function decidir(decisao: "aprovado" | "ajuste") {
    if (decisao === "ajuste" && comentario.trim().length < 3) {
      toast.error("Diga o que precisa mudar — sem isso a equipe não sabe o que corrigir.");
      return;
    }
    setEnviando(true);
    try {
      await onDecidir(decisao, decisao === "ajuste" ? comentario : "");
      toast.success(
        decisao === "aprovado"
          ? `Arte aprovada. O pedido ${osNumero} segue para a produção.`
          : `Pedido de ajuste registrado no pedido ${osNumero}. A equipe vai refazer a arte.`,
      );
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível registrar a sua resposta."));
    } finally {
      setEnviando(false);
    }
  }

  async function abrirPdf() {
    try {
      await abrirEmNovaAba(() =>
        obterUrl({ tipo: "arquivo", id: arte.arquivo_id, nome: arte.nome, para: "ver" }),
      );
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível abrir a arte."));
    }
  }

  return (
    <div className="rounded-lg border border-[color:var(--bex-amber)]/50 bg-card p-4 space-y-3">
      <div>
        <div className="font-mono text-xs text-muted-foreground">Pedido nº {osNumero}</div>
        <div className="font-semibold">{osTitulo || "Arte para aprovar"}</div>
        <div className="text-xs text-muted-foreground">
          {arte.nome} · enviada em {formatarDia(arte.pedida_em)} · responda até{" "}
          {formatarDia(arte.vence_em)}
        </div>
      </div>

      {previa === "imagem" ? (
        <div className="overflow-hidden rounded-md border bg-muted/30">
          {imagem.isPending ? (
            <div className="grid h-48 place-items-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : imagem.isError || !imagem.data ? (
            <div className="flex gap-2 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bex-amber)]" />
              <span>
                Não consegui carregar a imagem da arte ({mensagemErro(imagem.error)}). Não aprove
                sem ver — tente de novo ou peça o arquivo à equipe.
              </span>
            </div>
          ) : (
            <img src={imagem.data} alt={`Arte do pedido ${osNumero}`} className="h-auto w-full" />
          )}
        </div>
      ) : (
        <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => void abrirPdf()}>
          <ExternalLink className="mr-1 h-4 w-4" /> Abrir a arte para conferir
        </Button>
      )}

      <p className="text-sm text-muted-foreground">
        Confira textos, telefones e cores. Depois de aprovada, a arte vai para a máquina exatamente
        como está.
      </p>

      {!pedindoAjuste ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="h-11 flex-1"
            disabled={enviando || (previa === "imagem" && !imagem.data)}
            onClick={() => void decidir("aprovado")}
          >
            {enviando ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-1 h-4 w-4" />
            )}
            Aprovar e liberar para produção
          </Button>
          <Button variant="outline" className="h-11 flex-1" onClick={() => setPedindoAjuste(true)}>
            <PencilLine className="mr-1 h-4 w-4" /> Pedir ajuste
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={`ajuste-${arte.arquivo_id}`} className="text-sm font-medium">
            O que precisa mudar?
          </label>
          <Textarea
            id={`ajuste-${arte.arquivo_id}`}
            rows={3}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Ex.: o telefone certo é (96) 99111-6169 e o logo precisa ficar maior."
          />
          <div className="flex gap-2">
            <Button className="h-11" disabled={enviando} onClick={() => void decidir("ajuste")}>
              {enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Enviar pedido de ajuste
            </Button>
            <Button variant="ghost" className="h-11" onClick={() => setPedindoAjuste(false)}>
              Voltar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
