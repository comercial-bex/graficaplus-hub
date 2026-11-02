import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleHelp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import {
  comRespostasPadrao,
  acabamentoAjustado,
  pendenciasDasRespostas,
  perguntaDaLinha,
  processosDasRespostas,
  respondida,
  responder,
  respostaDe,
  type PerguntaDoProduto,
  type RespostaDoItem,
} from "@/domain/orcamentos/perguntas-do-item";
import { cn } from "@/lib/utils";

/**
 * As perguntas do produto no item do orçamento (02/11/2026). Só aparecem quando
 * o produto tem perguntas no Checklist da pasta dele; sem perguntas, nada muda
 * na tela. A resposta que acrescenta um processo entra no acabamento do item,
 * e a obrigatória sem resposta segura o botão de adicionar.
 */

/** As perguntas do produto, na ordem do cadastro. Só consulta com produto. */
export function usePerguntasDoProduto(produtoId: string | null) {
  return useQuery({
    queryKey: ["produto-perguntas", produtoId],
    enabled: !!produtoId,
    queryFn: async (): Promise<PerguntaDoProduto[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("produto_perguntas")
        .select("id, pergunta, descricao, obrigatoria, tipo_resposta, respostas, acoes, ordem, resposta_padrao, nao_perguntar")
        .eq("produto_id", produtoId)
        .order("ordem")
        .order("created_at");
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(perguntaDaLinha).filter((p) => p.id && p.pergunta);
    },
  });
}

/** Nome dos processos que as ações citam, para escrever no acabamento. */
function useNomesDosProcessos(ids: string[]) {
  const chave = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["processos-nomes", chave],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Record<string, string>> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("processos").select("id, nome").in("id", ids);
      if (error) throw error;
      return Object.fromEntries(((data ?? []) as { id: string; nome: string }[]).map((p) => [p.id, p.nome]));
    },
  });
}

export function PerguntasDoItem({
  produtoId,
  respostas,
  acabamento,
  onMudar,
  mostrarPendencias = false,
  desabilitado = false,
}: {
  produtoId: string | null;
  respostas: RespostaDoItem[];
  /** Texto atual do acabamento do item: os processos das respostas entram e saem dele. */
  acabamento: string;
  onMudar: (mudanca: { respostas: RespostaDoItem[]; acabamento: string }) => void;
  /** Depois de tentar salvar: marca as obrigatórias sem resposta. */
  mostrarPendencias?: boolean;
  desabilitado?: boolean;
}) {
  const perguntas = usePerguntasDoProduto(produtoId);
  const lista = perguntas.data ?? [];
  const idsDeProcesso = useMemo(() => [...new Set(lista.flatMap((p) => p.acoes.map((a) => a.processo_id)))], [lista]);
  const nomes = useNomesDosProcessos(idsDeProcesso);
  const nomesDe = (ids: string[]) => ids.map((id) => nomes.data?.[id]).filter((n): n is string => !!n);

  // Uma vez por produto: as respostas já definidas entram, e quando os nomes dos processos chegam
  // depois das respostas (item em edição) o acabamento ganha o que falta, sem apagar o que a pessoa
  // escreveu. Uma vez só para quem desmarca um padrão não ver ele voltar.
  const jaSincronizou = useRef<string | null>(null);
  useEffect(() => {
    if (!produtoId || jaSincronizou.current === produtoId || lista.length === 0) return;
    if (idsDeProcesso.length > 0 && !nomes.data) return;
    jaSincronizou.current = produtoId;
    const novas = comRespostasPadrao(lista, respostas);
    const devidos = nomesDe(processosDasRespostas(lista, novas));
    const ajustado = acabamentoAjustado(acabamento, [], devidos);
    if (novas !== respostas || ajustado !== acabamento) onMudar({ respostas: novas, acabamento: ajustado });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoId, nomes.data, lista.length]);

  if (!produtoId || lista.length === 0) return null;

  const pendentes = new Set(pendenciasDasRespostas(lista, respostas).map((p) => p.id));
  const visiveis = lista.filter((p) => !p.nao_perguntar);
  const definidas = lista.filter((p) => p.nao_perguntar);
  const respondidas = visiveis.filter((p) => respondida(respostaDe(respostas, p.id))).length;

  const mudar = (pergunta: PerguntaDoProduto, valor: string | string[]) => {
    const antes = nomesDe(processosDasRespostas(lista, respostas));
    const novas = responder(respostas, pergunta, valor);
    const depois = nomesDe(processosDasRespostas(lista, novas));
    onMudar({ respostas: novas, acabamento: acabamentoAjustado(acabamento, antes, depois) });
  };

  return (
    <section className="space-y-3 rounded-lg border bg-muted/20 p-3" aria-label="Perguntas do produto" data-testid="perguntas-do-item">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <CircleHelp className="h-4 w-4 text-link" aria-hidden="true" />
          Perguntas do produto
        </h3>
        <span className="text-xs text-muted-foreground">
          {respondidas} de {visiveis.length} {visiveis.length === 1 ? "respondida" : "respondidas"}
        </span>
      </div>

      {definidas.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="respostas-definidas">
          Já definido pela casa:{" "}
          {definidas.map((p) => `${p.pergunta} ${p.resposta_padrao}`).join(" · ")}
        </p>
      )}

      {visiveis.map((p) => {
        const atual = respostaDe(respostas, p.id);
        const pendente = mostrarPendencias && pendentes.has(p.id);
        const idDoCampo = `pergunta-${p.id}`;
        return (
          <div key={p.id} className={cn("space-y-1.5 rounded-md p-2", pendente && "bg-destructive/10 ring-1 ring-destructive/40")} data-pergunta={p.id}>
            <Label htmlFor={p.tipo_resposta === "numero" || p.tipo_resposta === "texto" ? idDoCampo : undefined} className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-sm font-medium">{p.pergunta}</span>
              {p.obrigatoria ? (
                <span className="text-xs text-muted-foreground">obrigatória</span>
              ) : (
                <span className="text-xs text-muted-foreground">opcional</span>
              )}
            </Label>
            {p.descricao && <p className="text-xs text-muted-foreground">{p.descricao}</p>}

            {p.tipo_resposta === "unica" && (
              <GradeDeCartoes rotulo={p.pergunta}>
                {p.respostas.map((opcao) => {
                  const marcada = atual?.resposta === opcao;
                  const acrescenta = p.acoes.some((a) => a.resposta === opcao);
                  return (
                    <CartaoDeEscolha
                      key={opcao}
                      ativo={marcada}
                      titulo={opcao}
                      detalhe={acrescenta ? "entra no acabamento" : undefined}
                      desabilitado={desabilitado}
                      onEscolher={() => mudar(p, marcada ? "" : opcao)}
                      className="min-h-14"
                    />
                  );
                })}
              </GradeDeCartoes>
            )}

            {p.tipo_resposta === "multipla" && (
              <GradeDeCartoes rotulo={p.pergunta}>
                {p.respostas.map((opcao) => {
                  const lista = Array.isArray(atual?.resposta) ? atual!.resposta : [];
                  const marcada = lista.includes(opcao);
                  const acrescenta = p.acoes.some((a) => a.resposta === opcao);
                  return (
                    <CartaoDeEscolha
                      key={opcao}
                      ativo={marcada}
                      titulo={opcao}
                      detalhe={acrescenta ? "entra no acabamento" : undefined}
                      desabilitado={desabilitado}
                      onEscolher={() => mudar(p, marcada ? lista.filter((x) => x !== opcao) : [...lista, opcao])}
                      className="min-h-14"
                    />
                  );
                })}
              </GradeDeCartoes>
            )}

            {(p.tipo_resposta === "numero" || p.tipo_resposta === "texto") && (
              <Input
                id={idDoCampo}
                type={p.tipo_resposta === "numero" ? "number" : "text"}
                inputMode={p.tipo_resposta === "numero" ? "decimal" : undefined}
                className="h-11 max-w-xs sm:h-9"
                value={typeof atual?.resposta === "string" ? atual.resposta : ""}
                disabled={desabilitado}
                onChange={(e) => mudar(p, e.target.value)}
              />
            )}

            {pendente && <p className="text-xs font-medium text-destructive">Responda antes de adicionar o item.</p>}
          </div>
        );
      })}
    </section>
  );
}
