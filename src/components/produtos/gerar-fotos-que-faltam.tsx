import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { mensagemErro } from "@/lib/erros";
import { gerarFotoDoProduto, mensagemDaFotoGerada } from "@/lib/api/produtos-foto-ia.functions";

/**
 * "Gerar fotos que faltam" (01/11/2026): o dono pediu o catálogo com foto em
 * todo produto, como no Holdprint. Em vez de abrir produto por produto, este
 * botão percorre os ativos sem foto, um de cada vez, até o lote de 8, e para
 * na hora se o saldo de IA acabar ou a pessoa mandar parar. Cada foto já fica
 * guardada no produto pelo servidor; aqui só se atualiza a lista.
 */
export const LOTE_DE_FOTOS = 8;

type ProdutoDaLista = { id: string; nome: string; imagem_url?: string | null; ativo?: boolean | null };

export function produtosSemFoto<P extends ProdutoDaLista>(produtos: readonly P[]): P[] {
  return produtos.filter((p) => p.ativo !== false && !(p.imagem_url ?? "").trim());
}

export function GerarFotosQueFaltam({ produtos }: { produtos: readonly ProdutoDaLista[] }) {
  const fila = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const [andamento, setAndamento] = useState<{ feitas: number; total: number; atual: string } | null>(null);
  const parar = useRef(false);

  const semFoto = produtosSemFoto(produtos);
  if (semFoto.length === 0) return null;
  const lote = semFoto.slice(0, LOTE_DE_FOTOS);

  async function rodar() {
    setConfirmando(false);
    parar.current = false;
    let geradas = 0;
    let feitas = 0;
    setAndamento({ feitas: 0, total: lote.length, atual: lote[0]?.nome ?? "" });
    for (const p of lote) {
      if (parar.current) break;
      setAndamento({ feitas, total: lote.length, atual: p.nome });
      try {
        const r = await gerarFotoDoProduto({ data: { produtoId: p.id } });
        if (r.estado === "ok") geradas += 1;
        else {
          toast.error(`${p.nome}: ${mensagemDaFotoGerada(r)}`);
          // Sem IA, sem saldo ou no limite, insistir só repete o erro.
          if (r.estado !== "falhou") break;
        }
      } catch (e) {
        toast.error(`${p.nome}: ${mensagemErro(e, "não deu para gerar a foto")}`);
      }
      feitas += 1;
      setAndamento({ feitas, total: lote.length, atual: p.nome });
    }
    setAndamento(null);
    await fila.invalidateQueries({ queryKey: ["produtos"] });
    const restantes = semFoto.length - geradas;
    toast.success(
      geradas === 0
        ? "Nenhuma foto gerada desta vez."
        : `${geradas} ${geradas === 1 ? "foto gerada" : "fotos geradas"}. ${restantes === 0 ? "Todos os produtos ativos têm foto." : `Faltam ${restantes}.`}`,
    );
  }

  if (andamento) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded border bg-muted/30 px-3 py-2 text-sm" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>
          Gerando foto {Math.min(andamento.feitas + 1, andamento.total)} de {andamento.total}: {andamento.atual}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={() => { parar.current = true; }}>
          <Square className="mr-1 h-3.5 w-3.5" /> Parar depois desta
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      {confirmando ? (
        <>
          <span>
            Vai gerar {lote.length} {lote.length === 1 ? "foto" : "fotos"} agora pela IA do Lovable ({semFoto.length} sem foto). Pode levar uns minutos.
          </span>
          <Button type="button" size="sm" onClick={() => void rodar()} data-testid="confirmar-lote-de-fotos">
            Confirmar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmando(false)}>
            Agora não
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmando(true)} data-testid="gerar-fotos-que-faltam">
          <Sparkles className="mr-1 h-3.5 w-3.5" /> Gerar fotos que faltam ({semFoto.length})
        </Button>
      )}
    </div>
  );
}
