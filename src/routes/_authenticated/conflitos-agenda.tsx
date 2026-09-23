/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CalendarX2,
  Factory,
  Link2Off,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/module-data";
import { mensagemErro } from "@/lib/erros";
import { dicaTela } from "@/lib/dicas";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/conflitos-agenda")({
  head: () => ({ meta: [{ title: "Conflitos de agenda — BEX PRINT OS" }] }),
  component: ConflitosAgendaPage,
});

/** Janela de leitura: reserva que terminou há mais de 90 dias não interessa mais. */
const DIAS_PARA_TRAS = 90;

type Reserva = {
  id: string;
  maquina_id: string;
  os_id: string | null;
  titulo: string;
  inicio: string;
  fim: string;
  inicio_previsto: string | null;
  fim_previsto: string | null;
  minutos_previstos: number | null;
  minutos_reais: number | null;
  inicio_real: string | null;
  fim_real: string | null;
  status: string;
  origem: string;
  prioridade: number | null;
  operador_id: string | null;
  maquinas: { nome: string } | null;
  ordens_servico: {
    id: string;
    numero: number;
    titulo: string;
    prazo_entrega: string | null;
    clientes: { nome: string } | null;
  } | null;
};

type Severidade = "alta" | "media";

type Risco = {
  id: string;
  tipo: "prazo" | "esquecida" | "estourou" | "sem_os" | "sobreposicao";
  severidade: Severidade;
  rotulo: string;
  titulo: string;
  detalhe: string;
  maquina: string;
  osId: string | null;
  osNumero: number | null;
};

const VIVAS = ["agendado", "em_producao"];

/**
 * Janela que conta para a trava do banco.
 *
 * A trava `maquinas_agenda_sem_sobreposicao` compara
 * `tstzrange(COALESCE(inicio_previsto, inicio), COALESCE(fim_previsto, fim))`.
 * A tela tem que medir a mesma coisa, senão diria "sobreposição" onde o banco
 * não vê nenhuma — ou o contrário, que é pior.
 */
function janela(r: Reserva) {
  return {
    inicio: new Date(r.inicio_previsto ?? r.inicio).getTime(),
    fim: new Date(r.fim_previsto ?? r.fim).getTime(),
  };
}

const estaViva = (r: Reserva) => VIVAS.includes(r.status);

/**
 * `prazo_entrega` é DATE puro ("2026-09-25"). `new Date("2026-09-25")` é lido
 * como meia-noite UTC e no Amapá (UTC-3) volta um dia — a OS apareceria
 * atrasada um dia antes do combinado. Montamos a data à mão, no fim do dia:
 * quem promete "dia 25" entrega até o fim do dia 25.
 */
function fimDoDiaLocal(dataIso: string) {
  const [ano, mes, dia] = dataIso.slice(0, 10).split("-").map(Number);
  return new Date(ano, mes - 1, dia, 23, 59, 59, 999);
}

function dataCurta(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Segunda 00:00 até domingo 23:59 da semana corrente, no fuso de quem olha. */
function semanaCorrente(agora: Date) {
  const inicio = new Date(agora);
  const diaDaSemana = (inicio.getDay() + 6) % 7; // domingo = 6, segunda = 0
  inicio.setDate(inicio.getDate() - diaDaSemana);
  inicio.setHours(0, 0, 0, 0);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 7);
  return { inicio: inicio.getTime(), fim: fim.getTime() };
}

function horasEntre(ms: number) {
  const horas = ms / 3_600_000;
  if (horas < 24) return `${Math.max(1, Math.round(horas))} h`;
  return `${Math.round(horas / 24)} dia${Math.round(horas / 24) > 1 ? "s" : ""}`;
}

/**
 * Conflitos de agenda: o que a trava do banco já impede e o que ela não vê.
 *
 * Desde a trava `maquinas_agenda_sem_sobreposicao`, duas reservas vivas da
 * mesma máquina no mesmo horário são recusadas na hora da gravação — o caso
 * clássico de dois revendedores querendo a plotter às 14h não chega mais a
 * existir no banco. Sobreposição, portanto, é sempre zero, e mostrar só isso
 * seria uma tela sem serventia.
 *
 * O valor está no que a trava NÃO pega: reserva que passou da hora e ninguém
 * concluiu, produção que estourou o tempo previsto, reserva solta sem OS e —
 * a mais cara — OS cujo prazo prometido ao cliente termina ANTES da última
 * reserva dela na máquina. Esse último é o "não vai dar" que hoje só aparece
 * no dia da entrega.
 */
function ConflitosAgendaPage() {
  const reservasQuery = useQuery({
    queryKey: ["conflitos-agenda", "reservas"],
    queryFn: async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - DIAS_PARA_TRAS);
      const { data, error } = await (supabase as any)
        .from("maquinas_agenda")
        .select(
          "id, maquina_id, os_id, titulo, inicio, fim, inicio_previsto, fim_previsto, minutos_previstos, minutos_reais, inicio_real, fim_real, status, origem, prioridade, operador_id, maquinas(nome), ordens_servico(id, numero, titulo, prazo_entrega, clientes(nome))",
        )
        .gte("fim", desde.toISOString())
        .order("inicio")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Reserva[];
    },
  });

  const maquinasQuery = useQuery({
    queryKey: ["conflitos-agenda", "maquinas-ativas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maquinas")
        .select("id, nome")
        .eq("ativa", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const erro = reservasQuery.error ?? maquinasQuery.error;
  useEffect(() => {
    if (erro) toast.error(mensagemErro(erro));
  }, [erro]);

  const reservas = reservasQuery.data ?? [];
  const maquinasAtivas = maquinasQuery.data ?? [];

  const painel = useMemo(() => {
    const agora = Date.now();
    const semana = semanaCorrente(new Date());
    const vivas = reservas.filter(estaViva);

    // Reserva "da semana" é a que encosta na semana corrente em qualquer
    // pedaço — uma tiragem que começa sexta e vira o sábado conta.
    const vivasNaSemana = vivas.filter((r) => {
      const j = janela(r);
      return j.inicio < semana.fim && semana.inicio < j.fim;
    });

    const maquinasComAgenda = new Set(vivasNaSemana.map((r) => r.maquina_id)).size;
    const semOs = vivas.filter((r) => !r.os_id);

    const riscos: Risco[] = [];

    // 1) Sobreposição de verdade. Deve ser sempre zero — a trava recusa antes
    //    de gravar. Se algum dia aparecer, é sinal de que a trava caiu, e é
    //    exatamente por isso que a conta é refeita aqui em vez de escrita 0.
    const porMaquina = new Map<string, Reserva[]>();
    for (const r of vivas) {
      const lista = porMaquina.get(r.maquina_id) ?? [];
      lista.push(r);
      porMaquina.set(r.maquina_id, lista);
    }
    for (const [, lista] of porMaquina) {
      const ordenada = [...lista].sort((a, b) => janela(a).inicio - janela(b).inicio);
      // Guardamos o MAIOR fim visto até aqui, não o da reserva anterior: uma
      // tiragem longa (08h–18h) engole várias reservas curtas, e comparando só
      // com a vizinha imediata a segunda curta passaria batida.
      let maiorFim = -Infinity;
      let doMaiorFim: Reserva | null = null;
      for (const r of ordenada) {
        const atual = janela(r);
        // Intervalo fechado-aberto: quem termina 16:00 e quem começa 16:00
        // estão encostados, não sobrepostos — igual à trava do banco.
        if (doMaiorFim && atual.inicio < maiorFim) {
          riscos.push({
            id: `sobre-${r.id}`,
            tipo: "sobreposicao",
            severidade: "alta",
            rotulo: "Sobreposição",
            titulo: `${r.maquinas?.nome ?? "Máquina"} com duas reservas no mesmo horário`,
            detalhe: `"${doMaiorFim.titulo}" e "${r.titulo}" se cruzam. Isso não deveria ser possível — avise o administrador.`,
            maquina: r.maquinas?.nome ?? "—",
            osId: r.os_id,
            osNumero: r.ordens_servico?.numero ?? null,
          });
        }
        if (atual.fim > maiorFim) {
          maiorFim = atual.fim;
          doMaiorFim = r;
        }
      }
    }

    // 2) Prazo prometido antes do fim da última reserva da OS. O mais caro:
    //    a promessa já está no contrato e a agenda diz que não cabe.
    const fimPorOs = new Map<string, { fim: number; reserva: Reserva }>();
    for (const r of vivas) {
      if (!r.os_id || !r.ordens_servico?.prazo_entrega) continue;
      const j = janela(r);
      const atual = fimPorOs.get(r.os_id);
      if (!atual || j.fim > atual.fim) fimPorOs.set(r.os_id, { fim: j.fim, reserva: r });
    }
    for (const [osId, { fim, reserva }] of fimPorOs) {
      const prazo = fimDoDiaLocal(reserva.ordens_servico!.prazo_entrega!);
      if (fim > prazo.getTime()) {
        riscos.push({
          id: `prazo-${osId}`,
          tipo: "prazo",
          severidade: "alta",
          rotulo: "Prazo não cabe",
          titulo: `OS-${reserva.ordens_servico?.numero} termina na máquina depois do prazo`,
          detalhe: `Prazo ${dataCurta(prazo)} · última reserva (${reserva.maquinas?.nome ?? "máquina"}) termina ${formatDateTime(
            reserva.fim_previsto ?? reserva.fim,
          )} — ${horasEntre(fim - prazo.getTime())} depois.${
            reserva.ordens_servico?.clientes?.nome ? ` Cliente: ${reserva.ordens_servico.clientes.nome}.` : ""
          }`,
          maquina: reserva.maquinas?.nome ?? "—",
          osId,
          osNumero: reserva.ordens_servico?.numero ?? null,
        });
      }
    }

    for (const r of vivas) {
      const j = janela(r);
      const nomeMaquina = r.maquinas?.nome ?? "—";

      // 3) Reserva esquecida: a hora passou e ninguém mexeu no status.
      if (r.status === "agendado" && j.fim < agora) {
        riscos.push({
          id: `esquecida-${r.id}`,
          tipo: "esquecida",
          severidade: "media",
          rotulo: "Hora passou",
          titulo: `"${r.titulo}" ficou em Agendado`,
          detalhe: `Terminaria ${formatDateTime(r.fim_previsto ?? r.fim)} em ${nomeMaquina}, há ${horasEntre(
            agora - j.fim,
          )}. Ou a peça rodou e ninguém deu baixa, ou a máquina ficou livre e a agenda não sabe.`,
          maquina: nomeMaquina,
          osId: r.os_id,
          osNumero: r.ordens_servico?.numero ?? null,
        });
      }

      // 4) Em produção passando do previsto — pelo relógio ou pelo apontamento.
      if (r.status === "em_producao") {
        const estourouRelogio = j.fim < agora;
        const estourouApontamento =
          (r.minutos_reais ?? 0) > 0 &&
          (r.minutos_previstos ?? 0) > 0 &&
          (r.minutos_reais ?? 0) > (r.minutos_previstos ?? 0);
        if (estourouRelogio || estourouApontamento) {
          const excedente = estourouApontamento
            ? `${(r.minutos_reais ?? 0) - (r.minutos_previstos ?? 0)} min a mais que os ${r.minutos_previstos} min previstos`
            : `${horasEntre(agora - j.fim)} além do previsto`;
          riscos.push({
            id: `estourou-${r.id}`,
            tipo: "estourou",
            severidade: "media",
            rotulo: "Passou do tempo",
            titulo: `"${r.titulo}" ainda em produção`,
            detalhe: `${nomeMaquina} · ${excedente}. Tudo que vier depois nessa máquina anda junto com o atraso.`,
            maquina: nomeMaquina,
            osId: r.os_id,
            osNumero: r.ordens_servico?.numero ?? null,
          });
        }
      }

      // 5) Reserva digitada à mão, sem OS: ocupa máquina e não aparece em
      //    nenhum custo nem em nenhum prazo.
      if (!r.os_id && r.origem === "manual" && j.fim >= agora) {
        riscos.push({
          id: `semos-${r.id}`,
          tipo: "sem_os",
          severidade: "media",
          rotulo: "Sem OS",
          titulo: `"${r.titulo}" ocupa ${nomeMaquina} sem OS vinculada`,
          detalhe: `${formatDateTime(r.inicio_previsto ?? r.inicio)} → ${formatDateTime(
            r.fim_previsto ?? r.fim,
          )}. Se for manutenção ou bloqueio, está certo; se for trabalho de cliente, o tempo não entra no custo de nenhuma OS.`,
          maquina: nomeMaquina,
          osId: null,
          osNumero: null,
        });
      }
    }

    const peso: Record<Severidade, number> = { alta: 0, media: 1 };
    riscos.sort((a, b) => peso[a.severidade] - peso[b.severidade]);

    return {
      vivasNaSemana: vivasNaSemana.length,
      maquinasComAgenda,
      sobreposicoes: riscos.filter((r) => r.tipo === "sobreposicao").length,
      semOs: semOs.length,
      riscos,
    };
  }, [reservas]);

  const carregando = reservasQuery.isLoading || maquinasQuery.isLoading;
  const agendaVazia = !carregando && !erro && reservas.length === 0;
  // Com a agenda ainda sem nenhuma reserva, zero não é saúde: é falta de uso.
  // Mostrar "0" nos quatro cartões seria dizer que está tudo em dia.
  // Se a leitura falhou (RLS, rede), vale o mesmo: não sabemos quantas são, e
  // "0 sobreposições" com a consulta caída é a pior mentira desta tela.
  const semDados = agendaVazia || !!erro;
  const kpi = (n: number) => (semDados ? "—" : n);
  const dicaVazia = agendaVazia ? "sem reservas ainda" : erro ? "não foi possível ler" : undefined;

  return (
    <div className="space-y-6">
      <SectionHeader
        breadcrumb="Produção"
        title="Conflitos de agenda"
        description="O que a trava do banco já impede, e o que ela não vê: reserva esquecida, produção estourando o tempo e prazo prometido que não cabe na máquina."
        ajuda={dicaTela("/conflitos-agenda")}
        actions={
          <Button asChild variant="outline" className="h-11 md:h-9">
            <Link to="/maquinas-agenda">Ver agenda</Link>
          </Button>
        }
      />

      {erro && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Não foi possível ler a agenda</AlertTitle>
          <AlertDescription>{mensagemErro(erro)}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Reservas vivas na semana"
          value={carregando ? "…" : kpi(painel.vivasNaSemana)}
          icon={CalendarClock}
          tone="cyan"
          hint={dicaVazia ?? "agendadas ou em produção"}
        />
        <KpiCard
          label="Máquinas com agenda"
          value={carregando ? "…" : kpi(painel.maquinasComAgenda)}
          icon={Factory}
          tone="magenta"
          hint={dicaVazia ?? `de ${maquinasAtivas.length} ativa${maquinasAtivas.length === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Sobreposições"
          value={carregando ? "…" : kpi(painel.sobreposicoes)}
          icon={ShieldCheck}
          tone={painel.sobreposicoes > 0 ? "amber" : "muted"}
          hint={
            painel.sobreposicoes > 0
              ? "a trava falhou"
              : (dicaVazia ?? "o banco recusa na gravação")
          }
        />
        <KpiCard
          label="Reservas sem OS"
          value={carregando ? "…" : kpi(painel.semOs)}
          icon={Link2Off}
          tone={painel.semOs > 0 ? "amber" : "muted"}
          hint={dicaVazia ?? "digitadas à mão"}
        />
      </div>

      {agendaVazia && (
        <Alert>
          <CalendarX2 className="h-4 w-4" />
          <AlertTitle>Nenhuma reserva de máquina ainda</AlertTitle>
          <AlertDescription className="space-y-3">
            <p className="text-sm">
              Os números acima estão em branco porque a agenda nunca foi usada — não porque a
              produção esteja em dia. Enquanto nenhuma OS estiver marcada em máquina, esta tela não
              tem o que conferir.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="h-11 md:h-9">
                <Link to="/maquinas-agenda">Reservar uma máquina</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link to="/os">Abrir uma OS e agendar as peças</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            O que ainda pode dar errado
            {!carregando && painel.riscos.length > 0 && (
              <StatusChip
                label={`${painel.riscos.length} ${painel.riscos.length === 1 ? "aviso" : "avisos"}`}
                tone="amber"
              />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {carregando && <p className="text-sm text-muted-foreground">Conferindo a agenda…</p>}

          {!carregando && !erro && painel.riscos.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <CalendarCheck className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium text-foreground">
                Nenhum conflito nesta semana. A agenda está limpa.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {agendaVazia
                  ? "Nada foi reservado, então não há o que checar."
                  : "Nenhuma reserva passou da hora, estourou o tempo previsto ou promete entrega antes do fim da máquina."}
              </p>
            </div>
          )}

          {painel.riscos.map((r) => (
            <div
              key={r.id}
              className={
                r.severidade === "alta"
                  ? "rounded-lg border border-l-4 border-border border-l-[color:var(--bex-magenta)] bg-card p-3 md:p-4"
                  : "rounded-lg border border-l-4 border-border border-l-[color:var(--bex-amber)] bg-card p-3 md:p-4"
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip label={r.rotulo} tone={r.severidade === "alta" ? "magenta" : "amber"} />
                <span className="text-xs text-muted-foreground">{r.maquina}</span>
              </div>
              <p className="mt-2 text-sm font-medium text-foreground">{r.titulo}</p>
              <p className="mt-1 text-sm text-muted-foreground">{r.detalhe}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {r.osId && (
                  <Button asChild size="sm" variant="outline" className="h-11 md:h-8">
                    <Link to="/os/$id" params={{ id: r.osId }}>
                      Abrir OS{r.osNumero ? ` ${r.osNumero}` : ""}
                    </Link>
                  </Button>
                )}
                <Button asChild size="sm" variant="ghost" className="h-11 md:h-8">
                  <Link to="/maquinas-agenda">Ver agenda</Link>
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-[color:var(--bex-cyan)]" />
            Por que a mesma máquina não é mais reservada duas vezes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Quando alguém tenta reservar uma máquina em horário que já tem reserva viva, o sistema
            recusa na hora, com a mensagem{" "}
            <span className="font-medium text-foreground">
              "Esta máquina já tem reserva nesse horário"
            </span>
            . A reserva errada não chega a ser gravada — não existe mais o caso de dois revendedores
            marcados na mesma plotter às 14h e ninguém perceber até a hora de imprimir.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Vale para reserva <span className="text-foreground">agendada</span> e{" "}
              <span className="text-foreground">em produção</span>.
            </li>
            <li>
              Reserva <span className="text-foreground">cancelada ou concluída</span> não ocupa mais
              a máquina: o horário fica livre para outra peça.
            </li>
            <li>
              Reserva encostada é permitida — uma termina às 16:00 e a outra começa às 16:00 sem
              reclamação.
            </li>
          </ul>
          <p className="flex items-center gap-2 pt-1 text-xs">
            <Timer className="h-3.5 w-3.5" />
            Esta tela olha os últimos {DIAS_PARA_TRAS} dias e tudo que está marcado para frente.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
