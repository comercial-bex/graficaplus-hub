/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Lock, Percent, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dica, DicaIcone } from "@/components/bex/Dica";
import { dicaAcao, dicaCampo } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { brl } from "@/domain/orcamentos/acordo";
import {
  centesimosDigitados,
  emCentavos,
  fraseDaAlcada,
  lerSituacao,
  pctBR,
  previaDoDesconto,
  textoDoInformado,
  type ModoDoDesconto,
  type SituacaoDoDesconto,
} from "@/domain/orcamentos/desconto";

/**
 * O desconto do orçamento, no quadro lateral, ao lado de Entrega e Pagamento.
 *
 * Quem decide é o banco: o gatilho de totais de `orcamentos` recusa desconto
 * acima da alçada de quem vende sem a permissão `desconto.approve`, venha da
 * tela, da API ou de onde for. Esta tela só PERGUNTA antes (a função
 * `desconto_do_orcamento` simula o que está digitado) para travar o botão com
 * o motivo, em vez de deixar a pessoa descobrir no erro.
 *
 * O que cada perfil vê:
 *   - quem vê preço: o desconto, o total e de quem é a decisão;
 *   - quem vê o financeiro: também até onde vai a alçada em reais e o piso.
 *     Mínimo e piso são custo disfarçado (custo = mínimo × (1 − margem −
 *     taxa)), por isso o banco nem manda esses números para o vendedor.
 */

const PREFIXO = (orcamentoId: string) => ["orcamento", orcamentoId, "desconto"] as const;

async function lerDesconto(
  orcamentoId: string,
  simulacao?: { modo: ModoDoDesconto; valor: number },
) {
  const { data, error } = await (supabase.rpc as any)("desconto_do_orcamento", {
    p_orcamento_id: orcamentoId,
    p_modo: simulacao?.modo ?? null,
    p_valor: simulacao?.valor ?? null,
  });
  if (error) throw error;
  return lerSituacao(data);
}

/**
 * A situação GRAVADA do desconto. A chave começa com ["orcamento", id]: é o
 * prefixo que a tela invalida ao mexer em item, pagamento ou status — o
 * desconto em % e a aprovação dependem do subtotal, então relê junto.
 */
export function useDescontoDoOrcamento(orcamentoId: string, habilitado: boolean) {
  return useQuery({
    queryKey: PREFIXO(orcamentoId),
    enabled: habilitado,
    queryFn: () => lerDesconto(orcamentoId),
  });
}

/** O valor depois de `ms` sem mudar — para não perguntar ao banco a cada tecla. */
function useAtrasado<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

export function DescontoDoOrcamento({
  orcamentoId,
  podeEditar,
  verCusto,
  onPrevia,
}: {
  orcamentoId: string;
  /** a tela deixa mexer (orcamentos.update e o orçamento não virou OS) */
  podeEditar: boolean;
  /** quem vê o financeiro vê mínimo e piso em reais */
  verCusto: boolean;
  /** total com o desconto DIGITADO (ainda não gravado), ou null — o Pagamento mostra as parcelas com ele */
  onPrevia?: (total: number | null) => void;
}) {
  const qc = useQueryClient();
  const consulta = useDescontoDoOrcamento(orcamentoId, true);
  const salvo = consulta.data;

  const [modo, setModo] = useState<ModoDoDesconto>("percentual");
  const [texto, setTexto] = useState("");
  const [confirmarPiso, setConfirmarPiso] = useState(false);

  // O gravado manda: mudou por outra porta (outra aba, outra pessoa, o
  // próprio botão), o campo segue. Sem desconto gravado, fica o modo que a
  // pessoa escolheu — percentual é como o balcão fala.
  useEffect(() => {
    if (!salvo) return;
    if (salvo.informado > 0) {
      setModo(salvo.modo);
      setTexto(textoDoInformado(emCentavos(salvo.informado)));
    } else {
      setTexto("");
    }
  }, [salvo?.modo, salvo?.informado]); // eslint-disable-line react-hooks/exhaustive-deps

  const centesimos = centesimosDigitados(texto);
  const subtotalC = emCentavos(salvo?.subtotal);
  const creditoC = emCentavos(salvo?.credito_parceiro);
  const previa = previaDoDesconto(subtotalC, creditoC, modo, centesimos);
  const gravadoC = emCentavos(salvo?.informado);
  const semNada = gravadoC === 0 && (centesimos ?? 0) === 0;
  const mudou = !!salvo && !semNada && (modo !== salvo.modo || centesimos !== gravadoC);

  // O que o banco diria do que está digitado: só pergunta quando mudou, e
  // depois de a pessoa parar de digitar.
  const pergunta = mudou && !previa.erro && centesimos != null ? `${modo}:${centesimos}` : null;
  const perguntaAtrasada = useAtrasado(pergunta, 350);
  const simulacao = useQuery({
    queryKey: [...PREFIXO(orcamentoId), "simulacao", perguntaAtrasada],
    enabled: !!perguntaAtrasada && perguntaAtrasada === pergunta,
    queryFn: () => {
      const [m, c] = (perguntaAtrasada as string).split(":");
      return lerDesconto(orcamentoId, { modo: m as ModoDoDesconto, valor: Number(c) / 100 });
    },
    staleTime: 30_000,
  });
  const conferindo = !!pergunta && (pergunta !== perguntaAtrasada || simulacao.isFetching);
  // A pergunta caiu (rede, sessão): dizer isso, em vez de "Conferindo…" para sempre.
  const falhouAoConferir =
    !!pergunta && pergunta === perguntaAtrasada && !simulacao.isFetching && simulacao.isError;
  const veredito: SituacaoDoDesconto | undefined = mudou
    ? pergunta && simulacao.data && perguntaAtrasada === pergunta
      ? simulacao.data
      : undefined
    : salvo;

  useEffect(() => {
    onPrevia?.(mudou && !previa.erro ? previa.totalCentavos / 100 : null);
  }, [mudou, previa.erro, previa.totalCentavos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPrevia?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const aplicar = useMutation({
    mutationFn: async (args: { modo: ModoDoDesconto; valor: number; aviso: string }) => {
      const { data, error } = await (supabase.rpc as any)("definir_desconto_do_orcamento", {
        p_orcamento_id: orcamentoId,
        p_modo: args.modo,
        p_valor: args.valor,
      });
      if (error) throw error;
      return lerSituacao(data);
    },
    onSuccess: (s, args) => {
      qc.setQueryData(PREFIXO(orcamentoId), s);
      toast.success(args.aviso);
      // total, parcelas e pendências da tela leem o orçamento de novo
      void qc.invalidateQueries({ queryKey: ["orcamento", orcamentoId] });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  if (consulta.isError) {
    return (
      <Card id="acordo-desconto" className="scroll-mt-48">
        <CardContent className="space-y-2 p-4 text-sm">
          <p className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            Não foi possível carregar o desconto: {mensagemErro(consulta.error)}
          </p>
          <Button size="sm" variant="outline" onClick={() => void consulta.refetch()}>
            Tentar de novo
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!salvo) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando o desconto…
      </p>
    );
  }

  const editavel = podeEditar && salvo.pode_editar;
  const valorDigitado = (centesimos ?? 0) / 100;
  const abaixoDoPiso = veredito?.alcada === "abaixo_do_piso";

  // Por que o botão trava — a mesma frase vai na dica do botão.
  const motivoTravado = !editavel
    ? salvo.fechado
      ? "Este orçamento já virou OS: o desconto ficou como foi vendido."
      : "Seu perfil vê o desconto, mas não altera o orçamento."
    : previa.erro
      ? previa.erro
      : !mudou
        ? "Digite um desconto diferente do que está gravado."
        : falhouAoConferir
          ? `Não deu para conferir a alçada: ${mensagemErro(simulacao.error)}`
          : conferindo || !veredito
            ? "Conferindo a alçada…"
            : !veredito.pode_aplicar
              ? dicaCampo("/orcamentos", "acima_da_alcada")
              : null;

  function gravar(valor: number, m: ModoDoDesconto, aviso: string) {
    aplicar.mutate({ modo: m, valor, aviso });
  }

  function aoAplicar() {
    if (abaixoDoPiso) return setConfirmarPiso(true);
    gravar(valorDigitado, modo, valorDigitado > 0 ? "Desconto aplicado" : "Desconto tirado");
  }

  return (
    <Card id="acordo-desconto" className="scroll-mt-48">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Percent className="h-4 w-4 text-[color:var(--bex-cyan)]" />
          Desconto
          <DicaIcone texto={dicaCampo("/orcamentos", "desconto")} rotulo="Desconto" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Itens</dt>
            <dd className="tabular-nums">{brl(salvo.subtotal)}</dd>
          </div>
          {salvo.credito_parceiro > 0 && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Crédito do parceiro</dt>
              <dd className="tabular-nums">− {brl(salvo.credito_parceiro)}</dd>
            </div>
          )}
        </dl>

        <div className="space-y-1.5">
          <Label htmlFor="desconto-valor" className="flex items-center gap-1.5 text-xs">
            Desconto em
            <DicaIcone
              texto={dicaCampo("/orcamentos", "modo_do_desconto")}
              rotulo="Desconto em % ou em R$"
            />
          </Label>
          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={modo}
              disabled={!editavel || aplicar.isPending}
              onValueChange={(v) => v && setModo(v as ModoDoDesconto)}
              aria-label="Desconto em percentual ou em reais"
              className="shrink-0 gap-0"
            >
              <ToggleGroupItem
                value="percentual"
                className="h-10 rounded-r-none px-3"
                aria-label="Em percentual"
              >
                %
              </ToggleGroupItem>
              <ToggleGroupItem
                value="valor"
                className="h-10 rounded-l-none border-l-0 px-3"
                aria-label="Em reais"
              >
                R$
              </ToggleGroupItem>
            </ToggleGroup>
            <Input
              id="desconto-valor"
              inputMode="decimal"
              placeholder="0"
              autoComplete="off"
              disabled={!editavel || aplicar.isPending}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !motivoTravado) aoAplicar();
              }}
              className="h-10 min-w-0 flex-1 tabular-nums"
              aria-describedby="desconto-efeito"
            />
          </div>
          <p id="desconto-efeito" className="text-xs text-muted-foreground" aria-live="polite">
            {previa.erro ? (
              <span className="text-destructive">{previa.erro}</span>
            ) : previa.descontoCentavos > 0 ? (
              <>
                −{" "}
                <strong className="tabular-nums text-foreground">
                  {brl(previa.descontoCentavos / 100)}
                </strong>
                {modo === "valor" ? ` (${pctBR(previa.pct)} dos itens)` : ""}
                {mudou ? " · ainda não aplicado" : ""}
              </>
            ) : (
              "Sem desconto."
            )}
          </p>
        </div>

        <div className="flex items-baseline justify-between gap-2 border-t pt-2">
          <span className="text-sm font-medium">Total para o cliente</span>
          <strong className="text-lg tabular-nums">
            {brl(previa.erro ? salvo.total : previa.totalCentavos / 100)}
          </strong>
        </div>

        {falhouAoConferir ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Não deu para conferir a alçada: {mensagemErro(simulacao.error)}
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => void simulacao.refetch()}
            >
              Tentar de novo
            </Button>
          </div>
        ) : (
          <Alcada
            veredito={veredito}
            salvo={salvo}
            mudou={mudou}
            conferindo={conferindo}
            verCusto={verCusto}
          />
        )}

        {editavel && (
          <div className="flex flex-wrap items-center gap-2">
            {salvo.pendente && !mudou && salvo.pode_aprovar ? (
              <Dica texto={dicaAcao("/orcamentos", "aprovar_desconto")}>
                <Button
                  size="sm"
                  disabled={aplicar.isPending}
                  onClick={() => gravar(salvo.informado, salvo.modo, "Desconto aprovado")}
                >
                  {aplicar.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-1 h-4 w-4" />
                  )}
                  Aprovar desconto
                </Button>
              </Dica>
            ) : (
              <Dica texto={motivoTravado ?? dicaAcao("/orcamentos", "aplicar_desconto")}>
                <Button
                  size="sm"
                  disabled={!!motivoTravado || aplicar.isPending}
                  onClick={aoAplicar}
                >
                  {aplicar.isPending || conferindo ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : motivoTravado && mudou && !previa.erro ? (
                    <Lock className="mr-1 h-4 w-4" />
                  ) : null}
                  {valorDigitado > 0 || !mudou ? "Aplicar desconto" : "Tirar desconto"}
                </Button>
              </Dica>
            )}
            {salvo.desconto > 0 && !mudou && (
              <Dica texto={dicaAcao("/orcamentos", "tirar_desconto")}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={aplicar.isPending}
                  onClick={() => gravar(0, salvo.modo, "Desconto tirado")}
                >
                  Tirar desconto
                </Button>
              </Dica>
            )}
            {mudou && (
              <Button
                size="sm"
                variant="ghost"
                disabled={aplicar.isPending}
                onClick={() => {
                  setModo(salvo.informado > 0 ? salvo.modo : modo);
                  setTexto(salvo.informado > 0 ? textoDoInformado(gravadoC) : "");
                }}
              >
                Voltar ao gravado
              </Button>
            )}
          </div>
        )}
        {!editavel && (
          <p className="flex gap-1.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {motivoTravado}
          </p>
        )}

        {verCusto && <ContaDaCasa salvo={salvo} />}
      </CardContent>

      <AlertDialog open={confirmarPiso} onOpenChange={setConfirmarPiso}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar desconto abaixo do piso?</AlertDialogTitle>
            <AlertDialogDescription>
              Com {brl(previa.descontoCentavos / 100)} de desconto o total fica em{" "}
              {brl(previa.totalCentavos / 100)}
              {veredito?.piso != null ? `, abaixo do piso de ${brl(veredito.piso)}` : ""}: o lucro
              some e cada peça sai do bolso da gráfica. Fica registrado que você aprovou.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmarPiso(false);
                gravar(valorDigitado, modo, "Desconto aplicado abaixo do piso");
              }}
            >
              Aplicar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** De quem é a decisão, numa linha, com a dica que explica a régua. */
function Alcada({
  veredito,
  salvo,
  mudou,
  conferindo,
  verCusto,
}: {
  veredito: SituacaoDoDesconto | undefined;
  salvo: SituacaoDoDesconto;
  mudou: boolean;
  conferindo: boolean;
  verCusto: boolean;
}) {
  if (mudou && (conferindo || !veredito)) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Conferindo a alçada…
      </p>
    );
  }
  const v = veredito ?? salvo;
  if (v.alcada === "sem_desconto") return null;

  // A régua, com número para quem pode ver e sem para quem não pode.
  const dicaDaRegra =
    v.regra === "limite_fixo"
      ? dicaCampo("/orcamentos", "desconto_sem_custo")
      : verCusto
        ? dicaCampo("/orcamentos", "alcada_do_desconto")
        : `${dicaCampo("/orcamentos", "alcada_do_desconto")} ${dicaCampo("/orcamentos", "alcada_sem_numero")}`;

  // Desconto gravado que perdeu a aprovação: a mensagem é outra.
  if (!mudou && v.pendente) {
    return (
      <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
        <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Desconto esperando aprovação
          <DicaIcone
            texto={dicaCampo("/orcamentos", "desconto_pendente")}
            rotulo="Desconto esperando aprovação"
          />
        </p>
        <p className="text-muted-foreground">
          {v.pode_aprovar
            ? "Os itens mudaram depois da aprovação. Confira e aprove de novo para converter em OS."
            : "Os itens mudaram depois da aprovação. Quem aprova desconto precisa aprovar de novo; sem isso o orçamento não vira OS."}
        </p>
      </div>
    );
  }

  const tom =
    v.alcada === "vendedor"
      ? "text-emerald-700 dark:text-emerald-400"
      : v.alcada === "abaixo_do_piso"
        ? "text-destructive"
        : "text-amber-700 dark:text-amber-400";
  const Icone = v.alcada === "vendedor" ? CheckCircle2 : AlertTriangle;
  const dica =
    v.alcada === "vendedor"
      ? dicaDaRegra
      : v.alcada === "abaixo_do_piso"
        ? dicaCampo("/orcamentos", "piso_do_desconto")
        : `${dicaCampo("/orcamentos", "acima_da_alcada")}`;

  return (
    <div className="space-y-1">
      <p className={cn("flex items-center gap-1.5 text-xs font-medium", tom)}>
        <Icone className="h-3.5 w-3.5 shrink-0" />
        {fraseDaAlcada(v)}
        <DicaIcone texto={dica} rotulo="De quem é a decisão" />
      </p>
      {v.alcada !== "vendedor" && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          Até onde quem vende decide sozinho
          <DicaIcone texto={dicaDaRegra} rotulo="Alçada de quem vende" />
        </p>
      )}
      {!mudou && v.aprovacao && v.aprovacao_valida && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          Aprovado por {v.aprovacao.nome ?? "quem aprova desconto"}
          {v.aprovacao.em ? ` em ${new Date(v.aprovacao.em).toLocaleDateString("pt-BR")}` : ""}
        </p>
      )}
      {v.regra === "limite_fixo" && v.desconto_max_vendedor != null && (
        <p className="text-xs text-muted-foreground">
          {v.itens_sem_custo === 1
            ? "1 item sem custo cadastrado"
            : `${v.itens_sem_custo} itens sem custo cadastrado`}
          : quem vende dá até {pctBR(v.limite_fixo_pct)} ({brl(v.desconto_max_vendedor)}).
        </p>
      )}
    </div>
  );
}

/** A conta da casa, só para quem vê o financeiro: até onde vai a alçada e onde o lucro zera. */
function ContaDaCasa({ salvo }: { salvo: SituacaoDoDesconto }) {
  if (salvo.regra !== "margem" || salvo.subtotal <= 0) return null;
  const pctDe = (v: number) => pctBR(Math.round((v / salvo.subtotal) * 10_000) / 100);
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 p-2.5 text-xs">
      {salvo.margem_impossivel ? (
        <p>
          Há item com margem mínima + taxas acima de 100%: nenhum desconto cabe na alçada de quem
          vende.
        </p>
      ) : salvo.desconto_max_vendedor != null && salvo.minimo != null ? (
        <p>
          Quem vende dá até{" "}
          <strong className="tabular-nums">{brl(salvo.desconto_max_vendedor)}</strong> (
          {pctDe(salvo.desconto_max_vendedor)}) — total mínimo {brl(salvo.minimo)}.
        </p>
      ) : null}
      {salvo.desconto_ate_piso != null && salvo.piso != null && (
        <p className="flex items-center gap-1 text-muted-foreground">
          O lucro zera com {brl(salvo.desconto_ate_piso)} ({pctDe(salvo.desconto_ate_piso)}) de
          desconto — piso {brl(salvo.piso)}.
          <DicaIcone texto={dicaCampo("/orcamentos", "piso_do_desconto")} rotulo="Piso" />
        </p>
      )}
      {(salvo.itens_so_material ?? 0) > 0 && (
        <p className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
          {salvo.itens_so_material === 1 ? "1 item" : `${salvo.itens_so_material} itens`} com custo
          só de material.
          <DicaIcone
            texto={dicaCampo("/orcamentos", "desconto_so_material")}
            rotulo="Custo só de material"
          />
        </p>
      )}
    </div>
  );
}
