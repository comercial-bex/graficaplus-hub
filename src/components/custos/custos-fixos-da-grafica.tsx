import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Lock, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import {
  agruparPorGrupo,
  CODIGOS_LIDOS,
  contagemDePendentes,
  formatarCustoFixo,
  fraseDaConfirmacao,
  fraseDoContador,
  itensDeCustoFixo,
  lerLinhaDeCustoFixo,
  lerValorDeCusto,
  maoDeObraPorHora,
  mensagemDoSalvarCusto,
  podeEditarCustosFixos,
  ROTULO_DO_GRUPO,
  type ItemDeCustoFixo,
  type LinhaDeCustoFixo,
} from "@/domain/custos/custos-fixos";
import { TEXTO_DA_VELOCIDADE_DA_PLOTTER } from "@/domain/maquinas/velocidade-de-calculo";

/**
 * Custos fixos da gráfica: os números que entram no custo real do produto e que o gestor e o financeiro preenchem.
 *
 * Sem tabela nova: são linhas de custos_tabela. Cada uma mostra o valor, de onde vem, se está pendente ou confirmada,
 * quem confirmou e quando. Salvar e confirmar chama a função confirmar_custo_fixo, que confere a permissão no banco.
 * Salvar sem confirmar mantém o item pendente e só passa pela escrita comum, que a RLS limita a quem tem custos.update.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- colunas e função novas ainda não estão nos tipos gerados
const banco = supabase as any;

const CHAVE = ["custos-fixos-da-grafica"];

const COR_PENDENTE = "text-[#8a5a00] dark:text-[#f5b942]";
const COR_CONFIRMADO = "text-[#146c43] dark:text-[#45d4a0]";

export function SeloDeConfirmacao({ pendente }: { pendente: boolean }) {
  const Icone = pendente ? CircleAlert : CircleCheck;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-base font-semibold",
        pendente ? COR_PENDENTE : COR_CONFIRMADO,
      )}
      data-estado={pendente ? "pendente" : "confirmado"}
    >
      <Icone className="h-5 w-5 shrink-0" aria-hidden />
      {pendente ? "Pendente" : "Confirmado"}
    </span>
  );
}

export function LinhaDeCusto({
  item,
  nomes,
  podeEditar,
  editando,
  rascunho,
  ocupado,
  aoEditar,
  aoMudar,
  aoSalvar,
  aoCancelar,
}: {
  item: ItemDeCustoFixo;
  nomes: Record<string, string>;
  podeEditar: boolean;
  editando: boolean;
  rascunho: string;
  ocupado: boolean;
  aoEditar: () => void;
  aoMudar: (t: string) => void;
  aoSalvar: (confirmar: boolean) => void;
  aoCancelar: () => void;
}) {
  const { definicao: d, linha, pendente } = item;
  const valorLido = lerValorDeCusto(rascunho, d.aceitaZero);
  return (
    <li className="space-y-2 py-4" data-testid={`custo-fixo-${d.codigo}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-base font-semibold">{d.rotulo}</span>
        <SeloDeConfirmacao pendente={pendente} />
      </div>
      <p className="text-base">{linha?.observacao?.trim() || d.fonte}</p>
      <p className="text-base">{fraseDaConfirmacao(linha, nomes)}</p>
      {editando ? (
        <div className="space-y-2">
          <label className="block">
            <span className="text-base font-medium">Novo valor, em {d.unidade}</span>
            <Input
              value={rascunho}
              onChange={(e) => aoMudar(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              className="mt-1 h-11 max-w-56 text-base md:text-base"
              aria-label={`Novo valor de ${d.rotulo}`}
              aria-invalid={rascunho.trim() !== "" && valorLido == null}
            />
          </label>
          {rascunho.trim() !== "" && valorLido == null ? (
            <p className="text-base font-semibold text-[#b42318] dark:text-[#ff8a80]" role="alert">
              Digite um número, por exemplo 2000 ou 1,1339.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-11 min-h-11 text-base"
              disabled={ocupado || valorLido == null}
              onClick={() => aoSalvar(true)}
            >
              Salvar e confirmar
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 min-h-11 text-base"
              disabled={ocupado || valorLido == null}
              onClick={() => aoSalvar(false)}
            >
              Salvar sem confirmar
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 min-h-11 text-base"
              onClick={aoCancelar}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-base font-bold tabular-nums" data-testid="valor-do-custo">
            {formatarCustoFixo(linha?.valor ?? null, d.unidade)}
          </span>
          {podeEditar && !d.somenteLeitura ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 min-h-11 text-base"
              onClick={aoEditar}
            >
              <Pencil className="mr-1.5 h-5 w-5" aria-hidden />
              Editar {d.rotulo}
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** A tela inteira, sem estado de rede, para renderizar em teste. */
export function BlocoDeCustosFixos({
  itens,
  nomes,
  podeEditar,
  editandoCodigo,
  rascunho,
  ocupado,
  aoEditar,
  aoMudar,
  aoSalvar,
  aoCancelar,
}: {
  itens: ItemDeCustoFixo[];
  nomes: Record<string, string>;
  podeEditar: boolean;
  editandoCodigo: string | null;
  rascunho: string;
  ocupado: boolean;
  aoEditar: (i: ItemDeCustoFixo) => void;
  aoMudar: (t: string) => void;
  aoSalvar: (i: ItemDeCustoFixo, confirmar: boolean) => void;
  aoCancelar: () => void;
}) {
  const contagem = contagemDePendentes(itens);
  const mo = itens.find((i) => i.definicao.codigo === "mo_custo_hora")?.linha?.valor ?? null;
  const enc = itens.find((i) => i.definicao.codigo === "mo_encargos_pct")?.linha?.valor ?? null;
  const porHora = maoDeObraPorHora(mo, enc);
  return (
    <section className="space-y-4 text-base" data-testid="custos-fixos-da-grafica">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Custos fixos da gráfica</h2>
        <p className="mt-1 max-w-3xl">
          Os números que entram no custo real de cada produto. Enquanto algum estiver pendente, o
          custo real é um piso otimista e a margem mostrada em preços por produto é maior que a
          verdadeira.
        </p>
        <p
          className="mt-2 text-base font-semibold"
          data-testid="contador-de-pendentes"
          aria-live="polite"
        >
          {fraseDoContador(contagem)}
        </p>
        <p className="mt-2 max-w-3xl" data-testid="texto-da-velocidade-da-plotter">
          Plotter i1600. {TEXTO_DA_VELOCIDADE_DA_PLOTTER}
        </p>
      </div>
      {!podeEditar ? (
        <div
          className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3"
          data-testid="so-leitura-dos-custos"
        >
          <Lock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>Você vê os custos fixos. Quem preenche e confirma é o gestor e o financeiro.</span>
        </div>
      ) : null}
      {agruparPorGrupo(itens).map(({ grupo, itens: doGrupo }) => (
        <Card key={grupo}>
          <CardContent className="p-4">
            <h3 className="text-base font-bold">{ROTULO_DO_GRUPO[grupo]}</h3>
            {grupo === "pessoal" && porHora != null ? (
              <p className="mt-1" data-testid="mao-de-obra-por-hora">
                O custo da mão de obra é{" "}
                {porHora.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} por hora
                com encargos.
              </p>
            ) : null}
            <ul className="divide-y divide-border">
              {doGrupo.map((i) => (
                <LinhaDeCusto
                  key={i.definicao.codigo}
                  item={i}
                  nomes={nomes}
                  podeEditar={podeEditar}
                  editando={editandoCodigo === i.definicao.codigo}
                  rascunho={rascunho}
                  ocupado={ocupado}
                  aoEditar={() => aoEditar(i)}
                  aoMudar={aoMudar}
                  aoSalvar={(c) => aoSalvar(i, c)}
                  aoCancelar={aoCancelar}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

export function CustosFixosDaGrafica() {
  const qc = useQueryClient();
  const { hasPermission, hasRole } = useAuth();
  const podeEditar = podeEditarCustosFixos({
    ehAdmin: hasRole("admin"),
    permissoes: [
      hasPermission("custos.fixos.update") ? "custos.fixos.update" : "",
      hasPermission("custos.update") ? "custos.update" : "",
    ],
  });
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");

  const dados = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await banco
        .from("custos_tabela")
        .select("id, codigo, valor, unidade, observacao, confirmado_em, confirmado_por")
        .eq("ativo", true)
        .in("codigo", [...CODIGOS_LIDOS]);
      if (error) throw new Error(mensagemDoSalvarCusto(String(error.message ?? "")));
      const linhas: LinhaDeCustoFixo[] = ((data ?? []) as Array<Record<string, unknown>>).map(
        lerLinhaDeCustoFixo,
      );
      const ids = [...new Set(linhas.map((l) => l.confirmado_por).filter((x): x is string => !!x))];
      const nomes: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: us } = await supabase.from("usuarios").select("id, nome").in("id", ids);
        for (const u of us ?? []) nomes[u.id] = u.nome;
      }
      return { linhas, nomes };
    },
  });

  const salvar = useMutation({
    mutationFn: async (v: { item: ItemDeCustoFixo; valor: number; confirmar: boolean }) => {
      const codigo = v.item.definicao.codigo;
      if (v.confirmar) {
        const { error } = await banco.rpc("confirmar_custo_fixo", {
          p_codigo: codigo,
          p_valor: v.valor,
        });
        if (error) throw new Error(mensagemDoSalvarCusto(String(error.message ?? "")));
        return;
      }
      const id = v.item.linha?.id;
      if (!id) throw new Error("Este custo ainda não existe no banco. Avise o suporte.");
      // .select() de volta separa "gravou" de "a RLS recusou em silêncio".
      const { data, error } = await banco
        .from("custos_tabela")
        .update({ valor: v.valor, confirmado_em: null, confirmado_por: null })
        .eq("id", id)
        .select("id");
      if (error) throw new Error(mensagemDoSalvarCusto(String(error.message ?? "")));
      if (!data || data.length === 0)
        throw new Error(
          "Seu perfil não pode salvar sem confirmar. Use Salvar e confirmar, ou peça ao gestor.",
        );
    },
    onSuccess: (_r, v) => {
      toast.success(
        v.confirmar
          ? "Custo salvo e confirmado. O custo real já usa o valor novo."
          : "Custo salvo. Ele continua pendente até alguém confirmar.",
      );
      void qc.invalidateQueries({ queryKey: CHAVE });
      void qc.invalidateQueries({ queryKey: ["parametros-da-casa"] });
      void qc.invalidateQueries({ queryKey: ["precos-por-produto"] });
      setEditando(null);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  if (dados.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (dados.isError)
    return (
      <p className="rounded-md border border-border p-4 text-base font-semibold" role="alert">
        Não deu para carregar os custos fixos. {mensagemErro(dados.error)}
      </p>
    );

  return (
    <BlocoDeCustosFixos
      itens={itensDeCustoFixo(dados.data?.linhas ?? [])}
      nomes={dados.data?.nomes ?? {}}
      podeEditar={podeEditar}
      editandoCodigo={editando}
      rascunho={rascunho}
      ocupado={salvar.isPending}
      aoEditar={(i) => {
        setEditando(i.definicao.codigo);
        setRascunho(i.linha?.valor != null ? String(i.linha.valor).replace(".", ",") : "");
      }}
      aoMudar={setRascunho}
      aoSalvar={(i, confirmar) => {
        const valor = lerValorDeCusto(rascunho, i.definicao.aceitaZero);
        if (valor != null) salvar.mutate({ item: i, valor, confirmar });
      }}
      aoCancelar={() => setEditando(null)}
    />
  );
}
