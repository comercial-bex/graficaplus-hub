import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Hourglass,
  Inbox,
  Loader2,
  MessageCircle,
  UserPlus,
  UsersRound,
  WifiOff,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/bex/KpiCard";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { useAuth } from "@/lib/auth-context";
import { dicaTela } from "@/lib/dicas";
import { cn } from "@/lib/utils";
import { infoDoSetor, rotuloDoMotivo, ESPERA_ATRASADA_MIN } from "@/domain/whatsapp/filas";
import {
  DIAS_DA_JANELA,
  formatarMinutos,
  mensagensPorDia,
  porAtendente,
  resumoDaEspera,
  resumoDoDia,
  resumoDosAtendimentos,
  resumoDosLeads,
  resumoDosOrcamentos,
  saudeDaConexao,
  type Saude,
} from "@/domain/whatsapp/visao-geral";
import { mapaDeNomes, useEquipe, useTempoRealDaCaixa } from "@/components/whatsapp/usar-caixa-de-entrada";
import { useVisaoGeral, LIMITE_MENSAGENS_DA_JANELA } from "@/components/whatsapp/usar-visao-geral";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";

export const Route = createFileRoute("/_authenticated/whatsapp-visao-geral")({
  head: () => ({ meta: [{ title: "Visão geral do WhatsApp — BEX PRINT OS" }] }),
  component: VisaoGeralPage,
});

const tooltipDoGrafico = {
  contentStyle: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "0.5rem",
    fontSize: "12px",
  },
  cursor: { fill: "var(--muted)", opacity: 0.4 },
};

/**
 * Visão geral do WhatsApp (08/10/2026): como está o atendimento agora e nos
 * últimos 7 dias — quem espera, quanto chegou e saiu, em quanto tempo a
 * equipe responde, quem atendeu e o que virou lead e orçamento. Tudo contado
 * das linhas do banco (domain/whatsapp/visao-geral.ts).
 */
function VisaoGeralPage() {
  const { hasPermission } = useAuth();
  const acesso = { leads: hasPermission("leads.read"), orcamentos: hasPermission("orcamentos.read") };
  useTempoRealDaCaixa();
  const dados = useVisaoGeral(acesso);
  const equipe = useEquipe();
  const nomes = mapaDeNomes(equipe.data);
  const [verTabela, setVerTabela] = useState(false);

  const cabecalho = (
    <SectionHeader
      ajuda={dicaTela("/whatsapp-visao-geral")}
      breadcrumb="Atendimento · WhatsApp"
      title="Visão geral"
      description={`Como está o atendimento agora e nos últimos ${DIAS_DA_JANELA} dias.`}
      className="mb-2"
      actions={
        <div className="flex gap-1.5">
          <Button asChild variant="outline" size="sm">
            <Link to="/whatsapp-fila-humana" aria-label="Abrir a fila humana">
              <Hourglass className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Fila humana</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/whatsapp" aria-label="Abrir a caixa de entrada">
              <MessageCircle className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Caixa de entrada</span>
            </Link>
          </Button>
        </div>
      }
    />
  );

  if (dados.isError) {
    return (
      <div className="space-y-4">
        {cabecalho}
        <FalhaDeConsulta
          titulo="Não foi possível carregar a visão geral"
          erro={dados.error}
          onTentarDeNovo={() => void dados.refetch()}
        />
      </div>
    );
  }
  if (dados.isPending) {
    return (
      <div className="space-y-4">
        {cabecalho}
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      </div>
    );
  }

  const d = dados.data;
  const espera = resumoDaEspera(d.conversas, d.agora);
  const hoje = resumoDoDia(d.mensagens, d.agora);
  const porDia = mensagensPorDia(d.mensagens, d.agora);
  const ats = resumoDosAtendimentos(d.atendimentos, d.agora, d.inicio);
  const pessoas = porAtendente(d.atendimentos, d.mensagens, nomes, d.inicio);
  const leads = d.leads ? resumoDosLeads(d.leads) : null;
  const orcamentos = d.orcamentos ? resumoDosOrcamentos(d.orcamentos) : null;
  const saude = saudeDaConexao(d.instancias, d.ultimaDoCliente, d.agora);
  const semMovimento = porDia.every((l) => l.recebidas === 0 && l.enviadas === 0);
  const maiorSetor = Math.max(1, ...espera.porSetor.map((s) => s.abertas));
  const motivos = Object.entries(ats.motivos).sort((a, b) => b[1] - a[1]);
  const enviadasHoje = [
    hoje.porQuem.equipe && `${hoje.porQuem.equipe} da equipe`,
    hoje.porQuem.celular && `${hoje.porQuem.celular} do celular`,
    hoje.porQuem.assistente && `${hoje.porQuem.assistente} da assistente`,
    hoje.porQuem.automacao && `${hoje.porQuem.automacao} automáticas`,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {cabecalho}

      <FaixaDaSaude saude={saude} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Esperando resposta"
          value={espera.esperando}
          icon={Hourglass}
          tone={espera.atrasadas > 0 ? "magenta" : "cyan"}
          delta={
            espera.maisAntiga
              ? `mais antiga há ${espera.maisAntiga.espera.texto}`
              : espera.abertas > 0
                ? `${espera.abertas} abertas, nenhuma esperando`
                : "ninguém esperando"
          }
          hint={`Conversas abertas em que o cliente escreveu e ninguém respondeu. ${espera.atrasadas} esperam há mais de ${ESPERA_ATRASADA_MIN / 60} h.`}
        />
        <KpiCard
          label="Recebidas hoje"
          value={hoje.recebidas}
          icon={Inbox}
          delta={`${hoje.enviadas} enviadas${enviadasHoje.length ? ` · ${enviadasHoje.join(", ")}` : ""}`}
          hint={`Mensagens de clientes desde a meia-noite (horário de Macapá). Propaganda de empresa não conta${hoje.deEmpresas ? ` (${hoje.deEmpresas} hoje)` : ""}.`}
        />
        <KpiCard
          label="Atendimentos hoje"
          value={ats.abertosHoje}
          icon={UsersRound}
          tone="muted"
          delta={`${ats.resolvidosHoje} resolvidos · ${ats.emAndamento} em andamento`}
          hint="Cada atendimento é um WA-AAMM-NNNN: abre quando o cliente escreve numa conversa sem atendimento ativo e fecha em Resolver."
        />
        <KpiCard
          label={`1ª resposta · ${DIAS_DA_JANELA} dias`}
          value={ats.primeiraResposta ? formatarMinutos(ats.primeiraResposta.mediana) : "—"}
          icon={Clock}
          tone="amber"
          delta={
            ats.primeiraResposta
              ? `média ${formatarMinutos(ats.primeiraResposta.media)} · ${ats.primeiraResposta.n} atendimento${ats.primeiraResposta.n === 1 ? "" : "s"}`
              : ats.semResposta > 0
                ? `${ats.semResposta} ainda sem resposta`
                : "nenhum atendimento respondido"
          }
          hint="Metade dos clientes recebeu a 1ª resposta de uma pessoa em até este tempo (mediana). Conta da abertura do atendimento até a 1ª mensagem da equipe; noite e fim de semana entram. Spam fica fora."
        />
        <KpiCard
          label={`Leads · ${DIAS_DA_JANELA} dias`}
          value={leads ? leads.total : "—"}
          icon={UserPlus}
          tone="muted"
          delta={
            leads
              ? `${leads.emAberto} em aberto · ${leads.ganhos} ganhos · ${leads.perdidos} perdidos`
              : "sem acesso a leads"
          }
          hint="Leads de origem WhatsApp criados na janela — nascem quando um número novo escreve."
        />
        <KpiCard
          label={`Orçamentos da caixa · ${DIAS_DA_JANELA} dias`}
          value={orcamentos ? orcamentos.total : "—"}
          icon={FileText}
          tone="muted"
          delta={
            orcamentos
              ? `${orcamentos.aprovados} aprovados · ${orcamentos.emRascunho} em rascunho`
              : "sem acesso a orçamentos"
          }
          hint="Orçamentos abertos a partir de uma conversa (botão Orçamento na caixa de entrada)."
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Mensagens por dia</h2>
              <p className="text-xs text-muted-foreground">
                Últimos {DIAS_DA_JANELA} dias · recebidas de clientes e enviadas (equipe, celular, assistente e
                automáticas)
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setVerTabela((v) => !v)} aria-pressed={verTabela}>
              {verTabela ? "Ver gráfico" : "Ver números"}
            </Button>
          </div>
          {semMovimento ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Nenhuma mensagem nos últimos {DIAS_DA_JANELA} dias.
            </p>
          ) : verTabela ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead className="text-right">Recebidas</TableHead>
                  <TableHead className="text-right">Enviadas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porDia.map((l) => (
                  <TableRow key={l.dia}>
                    <TableCell>{l.rotulo}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.recebidas}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.enviadas}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="h-56" role="img" aria-label="Gráfico de mensagens recebidas e enviadas por dia">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porDia} barGap={2} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
                  <XAxis
                    dataKey="rotulo"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip {...tooltipDoGrafico} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "12px", color: "var(--muted-foreground)" }}
                  />
                  <Bar
                    dataKey="recebidas"
                    name="Recebidas de clientes"
                    fill="var(--wa-recebidas)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar dataKey="enviadas" name="Enviadas" fill="var(--wa-enviadas)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {d.mensagensNoLimite && (
            <p className="mt-2 text-xs text-muted-foreground">
              Conta parcial: a janela passou de {LIMITE_MENSAGENS_DA_JANELA.toLocaleString("pt-BR")} mensagens.
            </p>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Conversas abertas por setor</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {espera.abertas} abertas · {espera.semResponsavel} sem responsável
          </p>
          <ul className="space-y-3">
            {espera.porSetor.map((s) => {
              const info = infoDoSetor(s.setor);
              return (
                <li key={s.setor}>
                  <Link
                    to="/whatsapp"
                    search={{ fila: s.setor }}
                    className="group block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full", info.ponto)} aria-hidden />
                        <span className="group-hover:underline">{info.rotulo}</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        <strong className="text-foreground">{s.abertas}</strong>
                        {s.esperando > 0 && <> · {s.esperando} esperando</>}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className="h-full rounded-full bg-[color:var(--wa-recebidas)]"
                        style={{ width: `${(s.abertas / maiorSetor) * 100}%` }}
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold">Quem atendeu</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Últimos {DIAS_DA_JANELA} dias · mensagens enviadas pelo sistema, atendimentos resolvidos e tempo até a 1ª
            resposta
          </p>
          {pessoas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Ninguém respondeu nem resolveu atendimento pelo sistema nesta semana. Resposta dada pelo celular aparece
              na conversa, mas não tem nome de quem mandou.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead className="text-right">Mensagens</TableHead>
                  <TableHead className="text-right">Resolvidos</TableHead>
                  <TableHead className="text-right">1ª resposta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pessoas.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.mensagens}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.resolvidos}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.primeiraResposta ? formatarMinutos(p.primeiraResposta.mediana) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Como os atendimentos terminaram</h2>
          <p className="mb-3 text-xs text-muted-foreground">Resolvidos nos últimos {DIAS_DA_JANELA} dias, por motivo</p>
          {motivos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum atendimento resolvido na semana.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {motivos.map(([motivo, n]) => (
                <li key={motivo} className="flex items-center justify-between gap-2">
                  <span>{rotuloDoMotivo(motivo)}</span>
                  <strong className="tabular-nums">{n}</strong>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

const ESTILO_DA_SAUDE: Record<Saude["nivel"], { icone: typeof CheckCircle2; cor: string; rotulo: string }> = {
  ok: { icone: CheckCircle2, cor: "text-emerald-600 dark:text-emerald-400", rotulo: "Funcionando" },
  atencao: { icone: AlertTriangle, cor: "text-amber-600 dark:text-amber-400", rotulo: "Atenção" },
  fora: { icone: WifiOff, cor: "text-destructive", rotulo: "Fora do ar" },
};

/** A conexão em uma linha: ícone + rótulo + texto (nunca só a cor). */
function FaixaDaSaude({ saude }: { saude: Saude }) {
  const e = ESTILO_DA_SAUDE[saude.nivel];
  const Icone = e.icone;
  return (
    <Card className="flex items-start gap-3 p-3" role="status">
      <Icone className={cn("mt-0.5 h-5 w-5 shrink-0", e.cor)} aria-hidden />
      <div className="min-w-0 text-sm">
        <p>
          <span className={cn("mr-1.5 text-[10px] font-bold uppercase tracking-wider", e.cor)}>{e.rotulo}</span>
          <strong>{saude.titulo}</strong>
        </p>
        <p className="text-xs text-muted-foreground">{saude.detalhe}</p>
      </div>
    </Card>
  );
}
