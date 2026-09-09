/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Factory, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  sugerirMaquina,
  sugestoesParaAplicar,
  type MaquinaDisponivel,
  type Produto,
  type Sugestao,
} from "@/domain/producao/sugerir-maquina";

/**
 * Sugerir a máquina de cada produto — propondo, nunca gravando sozinho.
 *
 * Nenhum dos 31 produtos tem máquina padrão, e por isso o aproveitamento de
 * bobina cai na máquina mais larga do parque. O palpite está avisado na tela,
 * mas continua sendo palpite dentro de uma conta de material.
 *
 * A sugestão vem com o MOTIVO ao lado e só é gravada por clique. Aplicar em
 * silêncio seria trocar um palpite escondido por outro — e este módulo existe
 * justamente porque gravar vínculo errado sem avisar é o padrão de falha nº 2
 * desta base.
 */
export function SugestaoDeMaquina({ produtos }: { produtos: Produto[] }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);

  const { data: maquinas = [] } = useQuery({
    queryKey: ["sugestao-maquinas"],
    queryFn: async (): Promise<MaquinaDisponivel[]> => {
      const { data } = await (supabase as any)
        .from("maquinas")
        .select("id, nome, base_cobranca, velocidade_m2_h")
        .eq("ativa", true)
        .order("nome");
      return (data ?? []) as MaquinaDisponivel[];
    },
  });

  const analise = useMemo(() => {
    const semMaquina = produtos.filter((p) => p.ativo !== false && !p.maquina_padrao_id);
    const linhas = semMaquina.map((p) => ({ produto: p, s: sugerirMaquina(p, maquinas) }));
    return {
      total: semMaquina.length,
      comSugestao: linhas.filter((x) => x.s.tipo === "maquina"),
      foraDoParque: linhas.filter((x) => x.s.tipo === "fora_do_parque"),
      semMaquina: linhas.filter((x) => x.s.tipo === "sem_maquina"),
    };
  }, [produtos, maquinas]);

  const aplicar = useMutation({
    mutationFn: async () => {
      const lote = sugestoesParaAplicar(
        produtos.filter((p) => p.ativo !== false),
        maquinas,
      );
      let gravados = 0;
      for (const { produto, sugestao } of lote) {
        // `.select("id")` não é enfeite: sem ele o PostgREST devolve sucesso e
        // zero linha quando a RLS barra a escrita, e contar o LAÇO diria "19
        // gravados" tendo gravado nenhum. Conta-se o que voltou.
        const { data, error } = await (supabase as any)
          .from("produtos")
          .update({ maquina_padrao_id: sugestao.maquinaId })
          .eq("id", produto.id)
          .select("id");
        if (error) throw error;
        gravados += (data ?? []).length;
      }
      if (gravados === 0 && lote.length > 0) {
        throw new Error(
          `Nenhum dos ${lote.length} produtos foi gravado — a permissão de escrita em produtos recusou em silêncio.`,
        );
      }
      return gravados;
    },
    onSuccess: (n) => {
      if (n === 0) toast.info("Nada a aplicar");
      else toast.success(`${n} produto(s) com máquina definida`);
      qc.invalidateQueries({ queryKey: ["produtos"] });
      qc.invalidateQueries({ queryKey: ["contexto-bobina"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (analise.total === 0 || maquinas.length === 0) return null;

  const linha = (x: { produto: Produto; s: Sugestao }) => (
    <li key={x.produto.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
      <span className="font-medium">{x.produto.nome}</span>
      {x.s.tipo === "maquina" && (
        <Badge variant="outline" className="font-normal gap-1">
          <Factory className="h-3 w-3" /> {x.s.maquinaNome}
        </Badge>
      )}
      <span className="w-full text-[11px] text-muted-foreground sm:w-auto sm:flex-1">{x.s.motivo}</span>
    </li>
  );

  return (
    <Card className="mb-6">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <h3 className="text-sm font-semibold">
            {analise.total} produto(s) sem máquina definida
          </h3>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAberto((v) => !v)}>
              {aberto ? "Fechar" : "Ver sugestões"}
            </Button>
            {analise.comSugestao.length > 0 && (
              <Button size="sm" disabled={aplicar.isPending} onClick={() => aplicar.mutate()}>
                <Wand2 className="h-3.5 w-3.5 mr-1" />
                Aplicar as {analise.comSugestao.length} sugestões
              </Button>
            )}
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Sem máquina no produto, o cálculo de aproveitamento de bobina usa a máquina mais
          larga do parque — o card avisa que supôs, mas continua sendo palpite dentro de uma
          conta de material. As sugestões abaixo vêm com o motivo e{" "}
          <strong>só são gravadas se você clicar</strong>.
        </p>

        {aberto && (
          <div className="space-y-4">
            {analise.comSugestao.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Roda no parque ({analise.comSugestao.length})
                </h4>
                <ul className="space-y-1">{analise.comSugestao.map(linha)}</ul>
              </div>
            )}

            {/* O achado que mais importa: a casa vende o que não produz. */}
            {analise.foraDoParque.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-destructive mb-1.5">
                  Nenhuma máquina da casa faz ({analise.foraDoParque.length})
                </h4>
                <p className="text-[11px] text-muted-foreground mb-1.5">
                  Estes produtos estão no catálogo e dependem de terceiro ou de máquina que o
                  parque não tem. Não é erro de cadastro — é informação de custo: o preço deles
                  precisa carregar a compra de fora, não a hora de máquina da casa.
                </p>
                <ul className="space-y-1">{analise.foraDoParque.map(linha)}</ul>
              </div>
            )}

            {analise.semMaquina.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Sem máquina, e está certo ({analise.semMaquina.length})
                </h4>
                <ul className="space-y-1">{analise.semMaquina.map(linha)}</ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
