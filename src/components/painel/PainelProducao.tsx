import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Factory, Lock, PackageCheck, RefreshCw, Timer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { useAuth } from "@/lib/auth-context";
import { etapaDe, rotuloDe, traduzirBloqueios } from "@/domain/os/etapas";
import { semDinheiro } from "@/domain/os/bloqueio-sem-dinheiro";
import {
  abertosPorOs,
  avisoDeClienteRetirou,
  avisoDeMandouParaAcabamento,
  erroDeMaquina,
  ondeEstaRodando,
  passosDaOs,
  type ApontamentoAberto,
  type ClienteRetirou,
  type MandouParaAcabamento,
  type Passo,
  type QuemAponta,
} from "@/domain/os/comecar-na-maquina";
import type { BloqueioOs } from "@/components/kanban/cartao-os";
import { SeloDaMaquina } from "@/components/kanban/icone-da-maquina";
import { SeletorDeMaquina } from "./SeletorDeMaquina";
import { PendenciasDoMeuPapel } from "./PendenciasDoMeuPapel";
import { MinhasComissoes } from "./MinhasComissoes";
import { cn } from "@/lib/utils";

/**
 * Painel de quem imprime, acaba e entrega.
 *
 * Até 20/09/2026 havia um painel só para os dez papéis: o impressor abria o
 * sistema e via faturamento do mês, margem por produto e gráfico de receita —
 * nada do que ele precisa para começar o dia, e vários números que ele nem
 * pode ver. A rotina real dele, conforme o organograma da gráfica, é uma fila:
 * o que imprimir agora, o que está no acabamento, o que já está pronto
 * esperando o cliente vir buscar.
 *
 * Por isso aqui não há dinheiro nenhum: é fila de trabalho, ordenada por
 * prazo, com o mais atrasado no topo.
 *
 * No celular a fila vem PRIMEIRO. O impressor abre o app instalado com uma
 * mão, na frente da máquina: o que ele precisa é ver a próxima OS e avançá-la
 * com um toque — não contadores e avisos antes da fila.
 *
 * O "COMEÇAR" ACENDE A MÁQUINA
 * Até 01/10/2026 o Começar gravava só o status genérico `em_producao`: nenhum
 * apontamento abria, e a TV da Oficina — que só escreve RODANDO com
 * apontamento aberto — não teria como saber em qual das cinco máquinas a peça
 * está. Agora o Começar de quem aponta pergunta a máquina (botões grandes, um
 * toque) e o banco grava status, máquina e apontamento juntos; "Mandar p/
 * acabamento" fecha o apontamento e avança na mesma transação. As regras de
 * que passo oferecer estão em domain/os/comecar-na-maquina.
 */

/**
 * Os status que significam "está comigo, na oficina".
 *
 * `retrabalho` entra: é a OS que a qualidade devolveu para refazer, justamente
 * a que mais precisa de atenção. `controle_qualidade` fica de fora — é da
 * qualidade, não do impressor.
 */
const NA_OFICINA = [
  "aguardando_producao",
  "producao",
  "em_producao",
  "em_impressao",
  "em_corte",
  "em_acabamento",
  "retrabalho",
  "em_uv",
  "em_laser_cnc",
  "em_3d",
] as const;

/** Já terminou e está esperando sair. */
const PRONTO_PARA_SAIR = ["aguardando_retirada", "aguardando_entrega"] as const;

interface OSDaFila {
  id: string;
  numero: number | null;
  titulo: string | null;
  status: string;
  prazo_entrega: string | null;
  /** 1 = urgente … 5 = mínima. É inteiro no banco, não texto. */
  prioridade: number | null;
  cliente_nome: string | null;
  // Decidem se "Pronta" vira aguardando retirada, entrega ou instalação.
  precisa_entrega: boolean | null;
  precisa_instalacao: boolean | null;
}

function useFila(status: readonly string[], chave: string) {
  return useQuery({
    queryKey: ["painel-producao", chave],
    queryFn: async (): Promise<OSDaFila[]> => {
      // A view operacional existe justamente para quem não pode ver valor:
      // selecionar a tabela crua traria colunas de dinheiro e a política
      // derrubaria a consulta inteira.
      //
      // `precisa_entrega` e `precisa_instalacao` existem na view desde a
      // migração 20260909230000 — conferido antes de nomear aqui, porque uma
      // coluna que a view não tem derruba a consulta inteira em silêncio.
      //
      // O nome do cliente vem da própria view (`cliente_nome`, conferido em
      // information_schema em 01/10/2026). Antes vinha de uma segunda consulta
      // em `clientes` que jogava o erro fora: se ela caísse, toda linha dizia
      // "Cliente não informado" e nada acusava. Embed (`clientes(nome)`) não
      // serve: view não tem chave estrangeira e o PostgREST derruba tudo.
      const { data, error } = await (supabase as any)
        .from("ordens_servico_operacional")
        .select(
          "id, numero, titulo, status, prazo_entrega, prioridade, cliente_nome, precisa_entrega, precisa_instalacao",
        )
        .in("status", status)
        .order("prazo_entrega", { ascending: true, nullsFirst: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as OSDaFila[];
    },
  });
}

/**
 * As travas de produção, numa chamada só — a mesma consulta do Kanban.
 *
 * São as MESMAS regras que `avancar_os_status` aplica: a RPC e esta função
 * chamam `os_bloqueios_para` no banco. Consultar antes evita que o impressor
 * descubra o impedimento só depois do toque, num toast vermelho.
 */
function useBloqueios() {
  return useQuery({
    queryKey: ["painel-producao", "bloqueios"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("os_bloqueios_do_quadro");
      if (error) throw error;
      const mapa = new Map<string, BloqueioOs[]>();
      for (const linha of (data ?? []) as { os_id: string; bloqueios: BloqueioOs[] }[]) {
        mapa.set(linha.os_id, linha.bloqueios ?? []);
      }
      return mapa;
    },
  });
}

/**
 * Em que máquina cada OS está rodando: os apontamentos ainda abertos.
 *
 * Uma consulta para o painel inteiro (há no máximo um aberto por máquina), e
 * SEM custo: só máquina e hora. `maquinas(nome, tipo)` é embed por chave
 * estrangeira de verdade (`apontamentos_producao_maquina_id_fkey`), e as
 * colunas foram conferidas em information_schema em 01/10/2026 — nome errado
 * aqui derrubaria a consulta inteira.
 */
function useApontamentosAbertos() {
  return useQuery({
    queryKey: ["painel-producao", "apontamentos-abertos"],
    queryFn: async (): Promise<ApontamentoAberto[]> => {
      const { data, error } = await (supabase as any)
        .from("apontamentos_producao")
        .select("id, os_id, maquina_id, iniciado_em, maquinas(nome, tipo)")
        .is("finalizado_em", null)
        .order("iniciado_em", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ApontamentoAberto[];
    },
  });
}

/**
 * Das OS prontas, quais o cliente JÁ retirou (retirada registrada) e ainda não
 * foram fechadas — o fechamento depende de pagamento e custos, e de quem tem
 * `os.close`.
 *
 * Sem esta consulta a OS retirada continuaria em "Prontos, esperando sair" com
 * o botão "Cliente retirou" de novo, e o contador diria que a peça ainda ocupa
 * o balcão. A TV da Oficina já a tira da parede pelo mesmo fato
 * (`os_saiu_fisicamente`). Colunas conferidas na função `cliente_retirou`,
 * que é quem grava: os_id, tipo = 'retirada', status = 'concluida'.
 */
function useRetiradasRegistradas(ids: string[]) {
  return useQuery({
    queryKey: ["painel-producao", "retiradas", ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await (supabase as any)
        .from("entregas_instalacoes")
        .select("os_id")
        .in("os_id", ids)
        .eq("tipo", "retirada")
        .eq("status", "concluida");
      if (error) throw error;
      return new Set(((data ?? []) as { os_id: string }[]).map((r) => r.os_id));
    },
  });
}

/**
 * Quantos apontamentos JÁ FINALIZADOS a OS tem — só a contagem, sem custo.
 *
 * Devolve `null` quando a consulta falha: quem chama então não afirma nada
 * sobre o tempo registrado (zero aqui seria "não há tempo", e não se sabe).
 */
async function apontamentosFinalizados(osId: string): Promise<number | null> {
  try {
    const { count, error } = await (supabase as any)
      .from("apontamentos_producao")
      .select("id", { count: "exact", head: true })
      .eq("os_id", osId)
      .not("finalizado_em", "is", null);
    if (error || typeof count !== "number") return null;
    return count;
  } catch {
    return null;
  }
}

/** Dias entre hoje e o prazo. Negativo = atrasado. */
function diasAte(prazo: string | null): number | null {
  if (!prazo) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  // Data sem hora é lida como UTC e volta um dia atrás no nosso fuso.
  const [ano, mes, dia] = prazo.slice(0, 10).split("-").map(Number);
  const alvo = new Date(ano, mes - 1, dia);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
}

function toneDoStatus(status: string): "magenta" | "cyan" | "muted" {
  if (status === "retrabalho") return "magenta";
  if (etapaDe(status) === "saida") return "cyan";
  return "muted";
}

function LinhaOS({
  os,
  bloqueios = [],
  abertos = [],
  quem,
  maquinaDesconhecida,
  movendo,
  onPasso,
}: {
  os: OSDaFila;
  bloqueios?: BloqueioOs[];
  /** Os apontamentos abertos DESTA OS. */
  abertos?: ApontamentoAberto[];
  /** Sem `quem` a linha é só leitura (a lista de prontos). */
  quem?: QuemAponta;
  /** A consulta dos apontamentos falhou: não dá para afirmar "sem máquina". */
  maquinaDesconhecida?: boolean;
  movendo?: boolean;
  onPasso?: (os: OSDaFila, passo: Passo) => void;
}) {
  const dias = diasAte(os.prazo_entrega);
  const atrasada = dias != null && dias < 0;
  const hoje = dias === 0;
  const passos = quem && onPasso ? passosDaOs(os, quem, abertos.length) : null;
  const passo = passos?.principal ?? null;
  const travada = bloqueios.length > 0;
  const rodando = ondeEstaRodando(abertos);
  const emProducao = etapaDe(os.status) === "producao";
  const naFila = etapaDe(os.status) === "pre_impressao";

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 md:flex-row md:items-center md:gap-3">
      {/* A linha abre a OS tocada — não a lista de todas. */}
      <Link
        to="/os/$id"
        params={{ id: os.id }}
        className="-m-1 flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md p-1 transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              #{os.numero ?? "—"}
            </span>
            <span className="truncate font-medium">{os.titulo || "Sem título"}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{os.cliente_nome ?? "Cliente não informado"}</span>
            <StatusChip label={rotuloDe(os.status)} tone={toneDoStatus(os.status)} />
            {/* `prioridade` é inteiro (1 = urgente). Comparado com a palavra
                "urgente", como estava, o selo nunca aparecia. */}
            {os.prioridade === 1 && (
              <Badge
                variant="outline"
                className="border-[color:var(--bex-magenta)]/50 text-[10px] text-[color:var(--bex-magenta)]"
              >
                urgente
              </Badge>
            )}
          </div>

          {/* Em que máquina está e desde quando — o mesmo fato que a TV da
              Oficina escreve na parede. Duas linhas = a OS está aberta em duas
              máquinas, e as duas seguem ocupadas. Sem custo, sem R$/h. */}
          {rodando.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {rodando.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5">
                  <SeloDaMaquina identidade={r.maquina} />
                  {r.desde && (
                    <span className="tabular-nums text-foreground">desde {r.desde}</span>
                  )}
                </span>
              ))}
              {rodando.length > 1 && (
                <span className="text-[color:var(--bex-amber)]">
                  aberta em {rodando.length} máquinas
                </span>
              )}
            </div>
          )}
          {/* Máquina aberta e a OS ainda na fila: alguém apontou pela ficha
              da OS, que não muda o status. Quem aponta acerta num toque. */}
          {naFila && rodando.length > 0 && (
            <p className="mt-1.5 text-xs text-[color:var(--bex-amber)]">
              máquina apontada, mas a OS ainda está na fila
            </p>
          )}
          {/* Em produção e sem apontamento: entrou pelo caminho antigo ou pelo
              Kanban. A parede não acende até alguém dizer a máquina. */}
          {emProducao && rodando.length === 0 && !maquinaDesconhecida && (
            <p className="mt-1.5 text-xs text-[color:var(--bex-amber)]">
              sem máquina apontada — o tempo não está contando
            </p>
          )}
        </div>

        <span
          className={cn(
            "shrink-0 font-mono text-xs tabular-nums",
            atrasada && "text-[color:var(--bex-magenta)]",
            hoje && "text-[color:var(--bex-amber)]",
            !atrasada && !hoje && "text-muted-foreground",
          )}
        >
          {dias == null
            ? "sem prazo"
            : atrasada
              ? `${Math.abs(dias)}d atrasada`
              : hoje
                ? "vence hoje"
                : `em ${dias}d`}
        </span>
      </Link>

      {passo && (
        <div className="flex flex-col gap-1.5 md:w-48 md:shrink-0">
          {/* Fora do Link (botão dentro de <a> é HTML inválido) e com stopPropagation
              por garantia: o toque avança a OS, não abre a ficha. */}
          <Button
            type="button"
            variant={travada || passos?.impedimento ? "outline" : "default"}
            className="h-11 w-full"
            disabled={travada || Boolean(passos?.impedimento) || movendo}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPasso?.(os, passo);
            }}
          >
            {movendo ? "Avançando..." : passo.rotulo}
            {!movendo && !travada && !passos?.impedimento && <ArrowRight className="ml-1 h-4 w-4" />}
          </Button>
          {/* O motivo em texto visível: no celular não existe hover para ler um title. */}
          {travada && (
            <p className="flex items-start gap-1 text-[11px] leading-snug text-[color:var(--bex-amber)]">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{bloqueios.map((b) => b.titulo).join(" · ")}</span>
            </p>
          )}
          {!travada && passos?.impedimento && (
            <p className="flex items-start gap-1 text-[11px] leading-snug text-[color:var(--bex-amber)]">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{passos.impedimento}</span>
            </p>
          )}
          {/* "Dizer a máquina" / "Outra máquina": abre os botões grandes. Do
              mesmo tamanho do principal — é toque de oficina, não link. */}
          {passos?.secundario && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={movendo}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPasso?.(os, passos.secundario!);
              }}
            >
              {passos.secundario.rotulo}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A consulta caiu — e isso NÃO é "nenhum trabalho na fila".
 *
 * Antes, a fila com erro e a fila vazia mostravam a mesma frase, e os
 * contadores marcavam zero: o impressor lia "nada para fazer" com a oficina
 * cheia.
 */
function FalhaAoCarregar({
  oQue,
  erro,
  tentando,
  onTentar,
}: {
  oQue: string;
  erro: unknown;
  tentando: boolean;
  onTentar: () => void;
}) {
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-[color:var(--bex-magenta)]/40 p-3">
      <p className="text-sm font-medium">Não deu para carregar {oQue}.</p>
      <p className="text-xs text-muted-foreground">{mensagemErro(erro)}</p>
      <Button type="button" variant="outline" className="h-11 w-full md:w-auto" disabled={tentando} onClick={onTentar}>
        <RefreshCw className="mr-1 h-4 w-4" />
        {tentando ? "Tentando..." : "Tentar de novo"}
      </Button>
    </div>
  );
}

/** Contador compacto para o celular: só o número e um rótulo curto. */
function KpiCompacto({
  label,
  value,
  tone,
}: {
  label: string;
  /** "—" quando a fila não carregou: zero ali seria mentira. */
  value: number | string;
  tone: "magenta" | "amber" | "cyan" | "muted";
}) {
  const cor = {
    magenta: "text-[color:var(--bex-magenta)]",
    amber: "text-[color:var(--bex-amber)]",
    cyan: "text-[color:var(--bex-cyan)]",
    muted: "text-foreground",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-card px-2 py-2 text-center">
      <p className={cn("text-2xl font-bold tabular-nums leading-none", cor)}>{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

export function PainelProducao() {
  const qc = useQueryClient();
  const oficina = useFila(NA_OFICINA, "oficina");
  const prontos = useFila(PRONTO_PARA_SAIR, "prontos");
  const travas = useBloqueios();
  const bloqueios = travas.data ?? new Map<string, BloqueioOs[]>();
  const apontamentos = useApontamentosAbertos();
  const { canSeeFinancials, canSeePrices, hasPermission } = useAuth();
  const [movendoId, setMovendoId] = useState<string | null>(null);
  /** A OS cujos botões de máquina estão abertos. */
  const [escolhendo, setEscolhendo] = useState<OSDaFila | null>(null);

  // Quem aponta escolhe a máquina; quem não aponta segue pelo caminho antigo.
  const quem: QuemAponta = {
    podeApontar: hasPermission("producao.start"),
    podeFinalizar: hasPermission("producao.finish"),
  };
  const abertos = abertosPorOs(apontamentos.data ?? []);

  const fila = oficina.data ?? [];
  const prontasTodas = prontos.data ?? [];
  const retiradas = useRetiradasRegistradas(prontasTodas.map((os) => os.id));
  // Sem a consulta de retiradas (caiu ou ainda carregando), nada é escondido:
  // o botão aparece e o banco responde "já registrada" se for o caso. Esconder
  // sem saber é que seria mentira.
  const jaRetirada = (os: OSDaFila) => retiradas.data?.has(os.id) ?? false;
  const saindo = prontasTodas.filter((os) => !jaRetirada(os));
  const retiradasSemFechar = prontasTodas.filter(jaRetirada);
  const atrasadas = fila.filter((os) => {
    const d = diasAte(os.prazo_entrega);
    return d != null && d < 0;
  }).length;
  const paraHoje = fila.filter((os) => diasAte(os.prazo_entrega) === 0).length;

  /**
   * Um toque, sem diálogo: o Kanban permite voltar se foi engano. A assinatura
   * real é avancar_os_status(os_id, novo_status) — sem prefixo p_. A própria
   * RPC valida as travas e grava o log de auditoria.
   */
  async function avancar(os: OSDaFila, destino: string) {
    if (movendoId) return;
    setMovendoId(os.id);
    try {
      const { error } = await (supabase.rpc as any)("avancar_os_status", {
        os_id: os.id,
        novo_status: destino,
      });
      if (error) {
        // `avancar_os_status` para "concluido" passa por `fechar_os`, e o que
        // volta são os códigos das travas. Mostrar "custos_operacionais;
        // pagamentos_pendentes" para o impressor não é dizer nada.
        const fechamento = traduzirBloqueios(mensagemErro(error));
        if (fechamento) {
          toast.error("A OS ainda não pode fechar", { description: fechamento });
          return;
        }
        // Qualquer outro passo ("Pronta", o Começar de quem não aponta) volta
        // com as travas do Kanban em texto: "A OS não pode avançar ainda: …;
        // Margem de 5.00% abaixo do mínimo de 20.00%". Mostrado cru, o número
        // da margem chegava ao operador — o corte só estava nos caminhos de
        // máquina. `erroDeMaquina` devolve o texto do banco quando não é trava.
        const e = erroDeMaquina(error, { canSeeFinancials, canSeePrices });
        toast.error(e.titulo, { description: e.descricao ?? undefined });
        return;
      }
      toast.success(
        destino === "concluido"
          ? `OS #${os.numero ?? "—"} fechada — resultado gravado e pós-venda agendada`
          : `OS #${os.numero ?? "—"} → ${rotuloDe(destino)}`,
      );
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setMovendoId(null);
      // Um prefixo só invalida as duas filas e as travas deste painel.
      qc.invalidateQueries({ queryKey: ["painel-producao"] });
    }
  }

  /**
   * Fecha o apontamento aberto e avança para o acabamento, numa transação só.
   *
   * Eram duas chamadas possíveis, e as duas falham pela metade: fechar e não
   * avançar deixa a OS "na máquina" sem apontamento; avançar e não fechar
   * deixa a máquina RODANDO uma OS que já está no acabamento. Um toque, sem
   * pedir quantidade — quem quiser informar usa a ficha da OS.
   */
  async function mandarParaAcabamento(os: OSDaFila) {
    if (movendoId) return;
    setMovendoId(os.id);
    try {
      const { data, error } = await (supabase.rpc as any)("mandar_para_acabamento", {
        p_os_id: os.id,
      });
      if (error) {
        const e = erroDeMaquina(error, { canSeeFinancials, canSeePrices });
        toast.error(e.titulo, { description: e.descricao ?? undefined });
        return;
      }
      const mandou = data as MandouParaAcabamento;
      // `fechados: 0` só diz que nenhuma máquina estava aberta NESTE toque.
      // Depois de "Terminei" o tempo já ficou gravado — então, antes de dizer
      // qualquer coisa sobre tempo, conta-se o que a OS tem finalizado.
      const jaRegistrados = mandou.fechados > 0 ? null : await apontamentosFinalizados(os.id);
      const aviso = avisoDeMandouParaAcabamento(mandou, jaRegistrados);
      toast.success(aviso.titulo, { description: aviso.descricao });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setMovendoId(null);
      qc.invalidateQueries({ queryKey: ["painel-producao"] });
    }
  }

  /**
   * A peça saiu pelo balcão. Registra a retirada para qualquer pessoa da equipe;
   * a OS só fecha junto se quem tocou pode fechar e estiver tudo em dia.
   *
   * Antes o botão chamava `avancar_os_status(os,'concluido')`, que exige
   * `os.close` (só administrador): o operador recebia erro e a OS seguia
   * "no balcão" no painel e na parede.
   */
  async function clienteRetirou(os: OSDaFila) {
    if (movendoId) return;
    setMovendoId(os.id);
    try {
      const { data, error } = await (supabase.rpc as any)("cliente_retirou", { p_os_id: os.id });
      if (error) {
        const e = erroDeMaquina(error, { canSeeFinancials, canSeePrices });
        toast.error(e.titulo, { description: e.descricao ?? undefined });
        return;
      }
      const aviso = avisoDeClienteRetirou(data as ClienteRetirou);
      toast.success(aviso.titulo, { description: aviso.descricao });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setMovendoId(null);
      qc.invalidateQueries({ queryKey: ["painel-producao"] });
    }
  }

  function darPasso(os: OSDaFila, passo: Passo) {
    if (passo.acao === "escolher_maquina") setEscolhendo(os);
    else if (passo.acao === "mandar_para_acabamento") mandarParaAcabamento(os);
    else if (passo.acao === "cliente_retirou") clienteRetirou(os);
    else avancar(os, passo.destino);
  }

  // Zero num contador de fila que não carregou é mentira: vira travessão.
  const semFila = oficina.isError;
  const semProntos = prontos.isError;

  // Ordem no celular: fila, contadores, prontos, pendências, comissões.
  // No desktop (md:) fica a ordem antiga: pendências e comissões antes.
  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <SectionHeader
        className="order-1 mb-0"
        ajuda={dicaTela("/dashboard")}
        breadcrumb="Print OS · Produção"
        title="Minha oficina"
        description="A fila de impressão e acabamento, do prazo mais apertado para o mais folgado."
        actions={
          <StatusChip
            label={semFila ? "fila não carregou" : `${fila.length} na fila`}
            tone={semFila ? "magenta" : fila.length > 0 ? "lime" : "muted"}
          />
        }
      />

      <div className="order-2 md:hidden">
        <Button asChild size="lg" variant="outline" className="h-12 w-full text-base">
          <Link to="/kanban">
            Quadro de produção <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="order-6 md:order-2">
        <PendenciasDoMeuPapel />
      </div>

      <div className="order-7 md:order-3">
        <MinhasComissoes />
      </div>

      {/* Celular: uma linha com três números. Desktop: os cartões de sempre. */}
      <div className="order-4 grid grid-cols-3 gap-2 md:hidden">
        <KpiCompacto
          label="Atrasadas"
          value={semFila ? "—" : atrasadas}
          tone={atrasadas > 0 ? "magenta" : "muted"}
        />
        <KpiCompacto label="Hoje" value={semFila ? "—" : paraHoje} tone={paraHoje > 0 ? "amber" : "muted"} />
        <KpiCompacto
          label="Prontas"
          value={semProntos ? "—" : saindo.length}
          tone={saindo.length > 0 ? "cyan" : "muted"}
        />
      </div>
      <div className="hidden md:order-4 md:grid md:grid-cols-3 md:gap-3">
        <KpiCard
          label="Atrasadas"
          value={semFila ? "—" : atrasadas}
          icon={Timer}
          tone={atrasadas > 0 ? "magenta" : "muted"}
          hint="passaram do prazo de entrega"
        />
        <KpiCard
          label="Vencem hoje"
          value={semFila ? "—" : paraHoje}
          icon={Factory}
          tone={paraHoje > 0 ? "amber" : "muted"}
        />
        <KpiCard
          label="Prontos para sair"
          value={semProntos ? "—" : saindo.length}
          icon={PackageCheck}
          tone={saindo.length > 0 ? "cyan" : "muted"}
          hint="aguardando retirada ou entrega"
        />
      </div>

      <Card className="order-3 bg-card border-border md:order-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Na oficina agora</CardTitle>
          <p className="text-sm text-muted-foreground">
            Comece pela do topo: é a de prazo mais apertado, não a mais recente.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {oficina.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : oficina.isError ? (
            <FalhaAoCarregar
              oQue="a fila da oficina"
              erro={oficina.error}
              tentando={oficina.isFetching}
              onTentar={() => oficina.refetch()}
            />
          ) : fila.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum trabalho na fila. Quando o atendimento mandar uma OS para produção, ela
              aparece aqui.
            </p>
          ) : (
            <>
              {/* Sem esta consulta o cartão não sabe a máquina. Dizer isso é
                  melhor do que escrever "sem máquina apontada" em tudo. */}
              {apontamentos.isError && (
                <p role="alert" className="text-xs text-[color:var(--bex-amber)]">
                  Não deu para ler em que máquina cada OS está ({mensagemErro(apontamentos.error)}).
                  Os botões continuam funcionando.
                </p>
              )}
              {/* Sem a lista de travas todo botão aparece livre. Não é verdade
                  que nada trava: só não deu para conferir antes do toque. */}
              {travas.isError && (
                <p role="alert" className="text-xs text-[color:var(--bex-amber)]">
                  Não deu para conferir as travas ({mensagemErro(travas.error)}). Os botões
                  aparecem livres, mas o banco confere de novo no toque.
                </p>
              )}
              {fila.map((os) => (
                <LinhaOS
                  key={os.id}
                  os={os}
                  bloqueios={(bloqueios.get(os.id) ?? []).map((b) =>
                    semDinheiro(b, canSeeFinancials, canSeePrices),
                  )}
                  abertos={abertos.get(os.id) ?? []}
                  quem={quem}
                  maquinaDesconhecida={apontamentos.isError || apontamentos.isLoading}
                  movendo={movendoId === os.id}
                  onPasso={darPasso}
                />
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {prontos.isError && (
        <Card className="order-5 bg-card border-border md:order-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prontos, esperando sair</CardTitle>
          </CardHeader>
          <CardContent>
            <FalhaAoCarregar
              oQue="os prontos para sair"
              erro={prontos.error}
              tentando={prontos.isFetching}
              onTentar={() => prontos.refetch()}
            />
          </CardContent>
        </Card>
      )}

      {saindo.length > 0 && (
        <Card className="order-5 bg-card border-border md:order-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prontos, esperando sair</CardTitle>
            <p className="text-sm text-muted-foreground">
              Já terminado e ocupando espaço na gráfica. Avise o atendimento para chamar o cliente.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Retirada no balcão ganha o botão "Cliente retirou"; entrega e
                instalação não têm passo aqui — a baixa é na tela de Entregas.
                Sem as travas de produção: elas valem para ir à máquina, não
                para a peça pronta sair pela porta. */}
            {saindo.map((os) => (
              <LinhaOS
                key={os.id}
                os={os}
                quem={quem}
                movendo={movendoId === os.id}
                onPasso={darPasso}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {retiradasSemFechar.length > 0 && (
        <Card className="order-5 bg-card border-border md:order-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Retiradas, falta fechar</CardTitle>
            <p className="text-sm text-muted-foreground">
              O cliente já levou. Da oficina não falta nada — o fechamento fica com o administrador.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {retiradasSemFechar.map((os) => (
              <LinhaOS key={os.id} os={os} />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="order-8 hidden justify-center md:order-7 md:flex">
        <Button asChild variant="outline" size="lg">
          <Link to="/kanban">
            Abrir o quadro de produção <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <SeletorDeMaquina
        os={escolhendo}
        abertos={escolhendo ? (abertos.get(escolhendo.id) ?? []) : []}
        onFechar={() => setEscolhendo(null)}
      />
    </div>
  );
}
