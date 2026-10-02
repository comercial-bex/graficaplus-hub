import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Play, Square, Timer } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";
import {
  avisoDeComecou,
  avisoDeSoApontou,
  erroDeMaquina,
  minutosEmPalavras,
  portaDoApontamento,
  type ComecouNaMaquina,
  type TerminouSoEstaMaquina,
} from "@/domain/os/comecar-na-maquina";

type Apontamento = {
  id: string;
  /** nulo = máquina apagada do cadastro */
  maquina_id: string | null;
  etapa: string | null;
  quantidade: number | null;
  iniciado_em: string;
  finalizado_em: string | null;
  observacoes: string | null;
  /** `custo_hora` só vem para quem pode ver custo — nem é pedido para os demais. */
  maquinas?: { nome: string; custo_hora?: number | null } | null;
};

type MaquinaParaApontar = { id: string; nome: string; custo_hora?: number | null };

const ETAPAS = ["Impressão", "Recorte", "Laminação", "Acabamento", "Aplicação"];

/**
 * Valor do item "padrão da máquina" no seletor de etapa. O Select não aceita
 * item com valor vazio, e sem um item assim quem escolhia uma etapa não tinha
 * como voltar atrás — o campo "opcional" virava obrigatório no primeiro toque.
 */
const ETAPA_PADRAO = "__padrao_da_maquina__";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Duração em horas e minutos, do jeito que a oficina fala. */
function duracao(inicio: string, fim: string | null): string {
  const ms = new Date(fim ?? Date.now()).getTime() - new Date(inicio).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h${String(min % 60).padStart(2, "0")}` : `${min} min`;
}

/**
 * Apontamento de produção por máquina.
 *
 * Era o elo morto que impedia o custo real de existir: sem apontamento, a OS
 * nunca tinha custo de máquina, o previsto do orçamento não ganhava um realizado
 * para comparar, e `fechar_os` ficava travado em "custos_operacionais".
 *
 * Fechar o apontamento LANÇA o custo (horas × custo/hora). Máquina sem custo/hora
 * registra o tempo e avisa — um custo de R$ 0,00 no resultado da OS mente pior
 * que um custo ausente, porque parece que a conta foi feita.
 *
 * QUEM APONTA NÃO VÊ CUSTO
 * Até 01/10/2026 este cartão escrevia o R$/h de cada máquina no seletor, o
 * custo de cada linha e "R$ X de custo de máquina lançado" no aviso — para o
 * operador, que é justamente quem usa o cartão e o único nível que não vê
 * dinheiro. Agora custo é só para `canSeeFinancials`, e para os demais a
 * coluna `custo_hora` nem entra na consulta: esconder na tela um número que o
 * navegador já recebeu não esconde nada. O custo continua sendo lançado no
 * banco do mesmo jeito; só não é mostrado a quem aperta o botão.
 *
 * A ETAPA É OPCIONAL DE VERDADE
 * O campo dizia "Opcional" e a função falhava sem ele (coluna NOT NULL). Desde
 * a migração 20261001110000, sem etapa vale a etapa padrão do tipo da máquina.
 *
 * "INICIAR PRODUÇÃO" É O MESMO FATO DO "COMEÇAR" DO PAINEL
 * Este cartão abria o apontamento por `iniciar_apontamento`, que não muda o
 * status nem grava a máquina na OS: a OS ficava em "Fila de produção" com a
 * máquina acesa na parede, e o painel do impressor não tinha como consertar
 * (medido em 01/10/2026). Agora, OS na fila ou em produção e sem etapa
 * escolhida entra por `comecar_na_maquina` — status, máquina e apontamento
 * juntos, com as travas do Kanban. Com etapa escolhida (Laminação…) continua
 * só o apontamento, e o aviso diz que o status não mudou. A regra está em
 * `portaDoApontamento`.
 *
 * CADA MÁQUINA ABERTA TEM O SEU "ENCERRAR"
 * A OS pode rodar em duas máquinas. O cartão mostrava só o apontamento aberto
 * MAIS NOVO — fechava primeiro justamente a máquina que continuava rodando.
 */

/**
 * O status da OS lido NA HORA do toque, pela view sem dinheiro.
 *
 * Não vem de cache: com um status velho, uma OS que já foi para o acabamento
 * seria levada de volta à produção pelo "Iniciar". Sem conseguir ler devolve
 * `null`, e a porta cai na antiga, que não mexe em status.
 */
async function statusDaOsAgora(osId: string): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from("ordens_servico_operacional")
    .select("id, status")
    .eq("id", osId)
    .maybeSingle();
  if (error) return null;
  return (data?.status as string | undefined) ?? null;
}

export function ApontamentoDaOS({ osId }: { osId: string }) {
  const qc = useQueryClient();
  const { hasPermission, canSeeFinancials, canSeePrices } = useAuth();
  const podeIniciar = hasPermission("producao.start");
  const podeFinalizar = hasPermission("producao.finish");

  const [maquina, setMaquina] = useState("");
  const [etapa, setEtapa] = useState("");
  /** quantidade produzida, por apontamento aberto */
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});

  const {
    data: apontamentos = [],
    isLoading,
    isError,
    error: erroDaLista,
  } = useQuery({
    // O nível de visão entra na chave: a resposta de quem vê custo não pode
    // ser servida do cache a quem não vê.
    queryKey: ["apontamentos", osId, canSeeFinancials],
    queryFn: async (): Promise<Apontamento[]> => {
      const { data, error } = await (supabase as any)
        .from("apontamentos_producao")
        .select(
          `id, maquina_id, etapa, quantidade, iniciado_em, finalizado_em, observacoes, maquinas(${
            canSeeFinancials ? "nome, custo_hora" : "nome"
          })`,
        )
        .eq("os_id", osId)
        .order("iniciado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Apontamento[];
    },
  });

  const {
    data: maquinas = [],
    isError: maquinasFalharam,
    error: erroDasMaquinas,
  } = useQuery({
    queryKey: ["maquinas-para-apontar", canSeeFinancials],
    enabled: podeIniciar,
    queryFn: async (): Promise<MaquinaParaApontar[]> => {
      // O erro era jogado fora: consulta caída virava seletor vazio, e o
      // operador lia "não há máquina" onde havia falha.
      const { data, error } = await (supabase as any)
        .from("maquinas")
        .select(canSeeFinancials ? "id, nome, custo_hora" : "id, nome")
        .eq("ativa", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as MaquinaParaApontar[];
    },
  });

  const iniciar = useMutation({
    mutationFn: async () => {
      if (!maquina) throw new Error("Escolha a máquina");
      // Sem etapa o banco usa a padrão do tipo da máquina.
      const escolhida = etapa && etapa !== ETAPA_PADRAO ? etapa : null;
      const status = await statusDaOsAgora(osId);

      if (portaDoApontamento(status, escolhida) === "comecar") {
        const { data, error } = await (supabase.rpc as any)("comecar_na_maquina", {
          p_os_id: osId,
          p_maquina_id: maquina,
        });
        if (error) throw error;
        return { porta: "comecar" as const, comecou: data as ComecouNaMaquina };
      }

      const { error } = await (supabase.rpc as any)("iniciar_apontamento", {
        p_os_id: osId,
        p_maquina_id: maquina,
        p_etapa: escolhida,
      });
      if (error) throw error;
      return { porta: "so_apontar" as const, status };
    },
    onSuccess: (r) => {
      setEtapa("");
      if (r.porta === "comecar") {
        const aviso = avisoDeComecou(r.comecou);
        toast.success(aviso.titulo, { description: aviso.descricao ?? undefined });
        // O status mudou junto: a ficha inteira precisa reler.
        qc.invalidateQueries({ queryKey: ["os", osId] });
      } else {
        // Só o tempo foi apontado. Dizer isso é o que evita a OS "na fila com
        // a máquina acesa" passar por normal.
        const aviso = avisoDeSoApontou(r.status);
        toast.success(aviso.titulo, { description: aviso.descricao });
      }
      qc.invalidateQueries({ queryKey: ["apontamentos", osId] });
      qc.invalidateQueries({ queryKey: ["painel-producao"] });
    },
    onError: (e: unknown) => {
      // As travas do Kanban sobem por aqui, e uma delas traz a margem escrita:
      // o mesmo corte do painel.
      const erro = erroDeMaquina(e, { canSeeFinancials, canSeePrices });
      toast.error(erro.titulo, { description: erro.descricao ?? undefined });
    },
  });

  const finalizar = useMutation({
    mutationFn: async (a: Apontamento) => {
      const digitada = quantidades[a.id];
      const quantidade = digitada ? Number(digitada) : null;

      // Quem não vê custo fecha pela função que não DEVOLVE custo:
      // `finalizar_apontamento` responde com o valor lançado, e esconder na
      // tela um número que o navegador já recebeu não esconde nada. O custo é
      // lançado do mesmo jeito, por dentro.
      if (!canSeeFinancials && a.maquina_id) {
        const { data, error } = await (supabase.rpc as any)("terminar_so_esta_maquina", {
          p_os_id: osId,
          p_maquina_id: a.maquina_id,
          p_quantidade: quantidade,
        });
        if (error) throw error;
        return { semCusto: true as const, id: a.id, terminou: data as TerminouSoEstaMaquina };
      }

      const { data, error } = await (supabase.rpc as any)("finalizar_apontamento", {
        p_apontamento_id: a.id,
        p_quantidade: quantidade,
        p_observacoes: null,
      });
      if (error) throw error;
      return {
        semCusto: false as const,
        id: a.id,
        fim: data as { custo_gerado: boolean; custo?: number; horas: number; aviso?: string },
      };
    },
    onSuccess: (r) => {
      setQuantidades((q) => {
        const resto = { ...q };
        delete resto[r.id];
        return resto;
      });
      if (r.semCusto) {
        const fechado = r.terminou.apontamentos?.[0];
        if (fechado) {
          toast.success(`Produção encerrada · ${minutosEmPalavras(fechado.minutos)} registrados`);
        } else {
          // Outra pessoa fechou antes: a lista na tela estava velha.
          toast.warning("Este apontamento já tinha sido encerrado.");
        }
      } else if (!canSeeFinancials) {
        // Para quem aponta, o que importa é o tempo. O custo foi lançado (ou
        // não, se a máquina não tem custo/hora) — isso é assunto do gestor.
        toast.success(
          `Produção encerrada · ${minutosEmPalavras(Number(r.fim.horas ?? 0) * 60)} registrados`,
        );
      } else if (r.fim.custo_gerado) {
        toast.success(`Produção encerrada · ${brl(r.fim.custo ?? 0)} de custo de máquina lançado`);
      } else {
        // Aviso, não erro: o tempo foi registrado; o que falta é cadastro.
        toast.warning(r.fim.aviso ?? "Tempo registrado sem custo.");
      }
      qc.invalidateQueries({ queryKey: ["apontamentos", osId] });
      qc.invalidateQueries({ queryKey: ["os", osId] });
      qc.invalidateQueries({ queryKey: ["painel-producao"] });
    },
    onError: (e: unknown) => {
      const erro = erroDeMaquina(e, { canSeeFinancials, canSeePrices });
      toast.error(erro.titulo, { description: erro.descricao ?? undefined });
    },
  });

  // TODOS os abertos, do mais antigo para o mais novo (a lista vem do mais
  // novo para o mais antigo). Pegar só o primeiro escondia a outra máquina.
  const abertos = apontamentos.filter((a) => !a.finalizado_em).reverse();
  // Só faz sentido contar para quem recebeu a coluna: sem ela todas pareceriam
  // "sem custo" e o aviso mentiria.
  const semCusto = canSeeFinancials ? maquinas.filter((m) => !Number(m.custo_hora)).length : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Timer className="h-4 w-4" />
          Produção por máquina
          {abertos.length > 0 && (
            <Badge variant="destructive" className="gap-1 font-normal">
              em andamento ·{" "}
              {abertos.length === 1
                ? duracao(abertos[0].iniciado_em, null)
                : `${abertos.length} máquinas`}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {canSeeFinancials && podeIniciar && semCusto > 0 && maquinas.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              {semCusto === maquinas.length
                ? "Nenhuma máquina tem custo/hora cadastrado"
                : `${semCusto} de ${maquinas.length} máquinas sem custo/hora`}
              . O tempo é registrado, mas não vira custo na OS — preencha em Máquinas.
            </div>
          </div>
        )}

        {podeIniciar && abertos.length === 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <Label className="text-xs">Máquina</Label>
              <Select value={maquina} onValueChange={setMaquina}>
                <SelectTrigger><SelectValue placeholder="Escolha a máquina" /></SelectTrigger>
                <SelectContent>
                  {maquinas.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome}
                      {canSeeFinancials &&
                        (Number(m.custo_hora) > 0
                          ? ` · ${brl(Number(m.custo_hora))}/h`
                          : " · sem custo/h")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {maquinasFalharam && (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  Não deu para carregar as máquinas: {mensagemErro(erroDasMaquinas)}
                </p>
              )}
            </div>
            <div className="w-48">
              <Label className="text-xs">Etapa (opcional)</Label>
              <Select value={etapa} onValueChange={setEtapa}>
                <SelectTrigger><SelectValue placeholder="Padrão da máquina" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ETAPA_PADRAO}>Padrão da máquina</SelectItem>
                  {ETAPAS.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={iniciar.isPending || !maquina} onClick={() => iniciar.mutate()}>
              <Play className="h-4 w-4 mr-1" /> Iniciar produção
            </Button>
            {/* Dito ANTES do toque: são duas portas, e só uma muda o status. */}
            <p className="basis-full text-xs text-muted-foreground">
              Sem etapa escolhida, a OS que está na fila ou em produção vai junto para o status
              da máquina — igual ao Começar do painel. Com etapa escolhida, só o tempo é
              apontado e o status da OS não muda.
            </p>
          </div>
        )}

        {podeFinalizar &&
          abertos.map((a) => (
            <div key={a.id} className="rounded-md border p-3 space-y-2">
              <div className="text-sm">
                <strong>{a.maquinas?.nome ?? "Máquina"}</strong>
                {a.etapa && ` · ${a.etapa}`} — rodando há{" "}
                <strong>{duracao(a.iniciado_em, null)}</strong>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-40">
                  <Label htmlFor={`qtd-produzida-${a.id}`} className="text-xs">
                    Quantidade produzida
                  </Label>
                  <Input
                    id={`qtd-produzida-${a.id}`}
                    type="number"
                    min="0"
                    value={quantidades[a.id] ?? ""}
                    onChange={(e) =>
                      setQuantidades((q) => ({ ...q, [a.id]: e.target.value }))
                    }
                  />
                </div>
                <Button
                  variant="destructive"
                  disabled={finalizar.isPending}
                  onClick={() => finalizar.mutate(a)}
                >
                  <Square className="h-4 w-4 mr-1" />{" "}
                  {canSeeFinancials ? "Encerrar e lançar custo" : "Encerrar produção"}
                </Button>
              </div>
            </div>
          ))}

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : isError ? (
          // Falha não é "nenhuma produção apontada".
          <div role="alert" className="text-sm text-destructive">
            Não deu para carregar os apontamentos desta OS: {mensagemErro(erroDaLista)}
          </div>
        ) : apontamentos.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {canSeeFinancials
              ? "Nenhuma produção apontada nesta OS. Sem apontamento, a OS não tem custo de máquina e o fechamento fica travado."
              : "Nenhuma produção apontada nesta OS. Sem apontamento, o fechamento da OS fica travado."}
          </div>
        ) : (
          <div className="divide-y rounded-md border text-sm">
            {apontamentos.map((a) => {
              const custoHora = Number(a.maquinas?.custo_hora ?? 0);
              const horas =
                (new Date(a.finalizado_em ?? Date.now()).getTime() -
                  new Date(a.iniciado_em).getTime()) /
                3600000;
              return (
                <div key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
                  <span className="font-medium">{a.maquinas?.nome ?? "—"}</span>
                  {a.etapa && <Badge variant="outline" className="font-normal">{a.etapa}</Badge>}
                  <span className="text-muted-foreground">
                    {duracao(a.iniciado_em, a.finalizado_em)}
                  </span>
                  {a.quantidade != null && (
                    <span className="text-muted-foreground">· {a.quantidade} un</span>
                  )}
                  {a.finalizado_em ? (
                    !canSeeFinancials ? null : custoHora > 0 ? (
                      <span className="ml-auto font-mono">{brl(horas * custoHora)}</span>
                    ) : (
                      <span className="ml-auto text-xs text-amber-600">sem custo/hora</span>
                    )
                  ) : (
                    <Badge variant="destructive" className="ml-auto font-normal">aberto</Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
