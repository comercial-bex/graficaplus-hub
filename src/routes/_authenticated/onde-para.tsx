import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Hourglass, RefreshCw, TimerOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { DataPanel } from "@/components/bex/DataPanel";
import { NeonButton } from "@/components/bex/NeonButton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { etapaDe, rotuloDe, setorDe, type Etapa } from "@/domain/os/etapas";
import { formatarData } from "@/domain/os/prazo";

export const Route = createFileRoute("/_authenticated/onde-para")({
  head: () => ({
    meta: [
      { title: "Onde o trabalho para — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Em que etapa cada OS está parada, há quantos dias, e qual delas é o gargalo da oficina hoje.",
      },
      { property: "og:title", content: "Onde o trabalho para — BEX PRINT OS" },
      {
        property: "og:description",
        content: "O gargalo da produção medido pelo histórico de status, não pelo updated_at.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OndeParaPage,
});

/* ------------------------------------------------------------------ *
 * O contrato de `onde_o_trabalho_para()`.
 *
 * Esta tela não mostra dinheiro nenhum — nem preço, nem custo, nem margem.
 * Por isso não há `useAuth()` aqui: não existe campo para esconder por nível
 * de visão. A RPC já exige `is_staff`, e quem não for recebe 42501 (tratado
 * mais abaixo com texto próprio, em vez de um "erro" genérico).
 * ------------------------------------------------------------------ */

type EtapaParada = {
  /** valor do enum `status_os` — NUNCA mostrado cru; passa por `rotuloDe`. */
  status: string;
  paradas: number;
  /** null quando o banco não conseguiu calcular a mediana — ausência, não zero. */
  mediana_dias: number | null;
  mais_de_7_dias: number;
  atrasadas: number;
  pior_caso: number | null;
};

type OsPresa = {
  os_id: string;
  numero: number;
  titulo: string | null;
  status: string;
  dias_parada: number;
  atrasada: boolean;
  prazo_entrega: string | null;
  cliente: string | null;
};

type Gargalo = {
  status: string;
  travadas: number;
  mediana_dias: number | null;
  atrasadas: number;
};

type Resposta = {
  etapas: EtapaParada[];
  mais_presas: OsPresa[];
  gargalo: Gargalo | null;
  gerado_em: string;
};

/**
 * A cor da faixa vem da ETAPA do fluxo, não do status.
 *
 * A RPC agrupa por status (são 26), e 26 cores não é legenda, é confete. As
 * etapas são cinco e já existem em `domain/os/etapas`: quem olha a faixa vê
 * "o trabalho está todo na entrada", que é a leitura que interessa.
 */
const COR_DA_ETAPA: Record<Etapa, string> = {
  entrada: "bg-[color:var(--bex-cyan)]",
  pre_impressao: "bg-[color:var(--bex-magenta)]",
  producao: "bg-[color:var(--bex-amber)]",
  acabamento: "bg-[color:var(--bex-cyan)]/50",
  saida: "bg-[color:var(--bex-magenta)]/50",
  fora_do_fluxo: "bg-muted-foreground/60",
};

function corDoStatus(status: string): string {
  const e = etapaDe(status);
  return e ? COR_DA_ETAPA[e] : "bg-muted-foreground/60";
}

/** "16,2 d" — uma casa decimal, como o banco devolve. Null vira travessão. */
function dias(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`;
}

function OndeParaPage() {
  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["onde-o-trabalho-para"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("onde_o_trabalho_para");
      if (error) throw error;
      return (data ?? null) as Resposta | null;
    },
    // Corrigido pelo verificador: recusa por papel (42501) não melhora na
    // segunda tentativa. Sem esta trava o react-query insistia três vezes com
    // espera crescente, e quem não é da equipe ficava vendo "Carregando..."
    // por vários segundos antes de aparecer o texto que explica o bloqueio.
    // Mesmo padrão de `routes/parceiro.tsx`.
    retry: (tentativas, erro) =>
      (erro as { code?: string } | null)?.code !== "42501" && tentativas < 2,
  });

  // 42501 é a recusa da própria RPC (`is_staff`), não uma falha. Merece texto
  // próprio: "tente novamente" não resolve quem simplesmente não tem o papel.
  const semAcesso = (error as { code?: string } | null)?.code === "42501";

  // Regra da casa: erro sempre traduzido e com aviso na tela.
  //
  // Corrigido pelo verificador: a recusa da RPC ("Acesso negado.", 42501) não
  // casa com nenhuma regra de `mensagemErro` — nem por código (só 23P01 está
  // lá), nem por texto, nem pelo teste de acento (a frase não tem nenhum). Caía
  // na genérica, e o toast dizia "Tente novamente" enquanto o cartão ao lado
  // dizia "Esta tela é da equipe" e nem oferecia o botão de tentar. Duas
  // respostas opostas na mesma tela, e um `[erro não traduzido]` no console.
  useEffect(() => {
    if (!error) return;
    if (semAcesso) toast.error("Esta tela é da equipe da gráfica.");
    else toast.error(mensagemErro(error));
  }, [error, semAcesso]);

  const etapas = data?.etapas ?? [];
  const presas = data?.mais_presas ?? [];
  const gargalo = data?.gargalo ?? null;

  const totalParadas = etapas.reduce((a, e) => a + Number(e.paradas ?? 0), 0);
  const totalVelhas = etapas.reduce((a, e) => a + Number(e.mais_de_7_dias ?? 0), 0);
  const totalAtrasadas = etapas.reduce((a, e) => a + Number(e.atrasadas ?? 0), 0);

  if (error) {
    return (
      <div>
        <SectionHeader
          ajuda={dicaTela("/onde-para")}
          breadcrumb="Produção"
          title="Onde o trabalho para"
          description="Cada OS na etapa em que está, parada desde que entrou nela. Quem precisa agir para ela andar."
        />
        <Card className="border-destructive/40">
          <CardContent className="space-y-3 p-5 text-sm">
            <div className="flex items-center gap-2 font-bold text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {semAcesso ? "Esta tela é da equipe" : "Não deu para carregar"}
            </div>
            <p className="text-muted-foreground">
              {semAcesso
                ? "O quadro de gargalos mostra OS de todos os clientes, então só abre para quem é da equipe da gráfica. Se você deveria ver isto, peça ao administrador para conferir o seu perfil."
                : mensagemErro(error)}
            </p>
            {!semAcesso && (
              <NeonButton onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
                Tentar de novo
              </NeonButton>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/onde-para")}
        breadcrumb="Produção"
        title="Onde o trabalho para"
        description="Cada OS na etapa em que está, parada desde que entrou nela. Quem precisa agir para ela andar."
        actions={
          <NeonButton onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Conferindo..." : "Atualizar"}
          </NeonButton>
        }
      />

      {isLoading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : etapas.length === 0 ? (
        /* Vazio de verdade: nenhuma OS viva. Dizer POR QUE está vazio, senão a
           tela parece quebrada — é exatamente o caso em que "0" mente. */
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <Hourglass className="mx-auto h-8 w-8 text-[color:var(--bex-cyan)]" />
            <p className="text-lg font-bold text-foreground">Nada parado</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Só entram aqui as OS vivas — as que ainda esperam alguém agir. Concluída,
              faturada e cancelada ficam de fora de propósito: elas já saíram da fila e
              contá-las inflaria o gargalo com trabalho que ninguém precisa destravar.
            </p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Se a oficina tem trabalho na bancada e esta tela está vazia, é sinal de que
              as OS não estão sendo abertas no sistema.
            </p>
            <Link
              to="/os"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-[color:var(--bex-cyan)]/40 px-4 text-sm font-bold text-[color:var(--bex-cyan)] active:bg-[color:var(--bex-cyan)]/10"
            >
              Ver as ordens de serviço
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* 1. O gargalo — a única frase que alguém precisa ler com pressa. */}
          {gargalo && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
                    Gargalo agora: {rotuloDe(gargalo.status)} — {gargalo.travadas}{" "}
                    {gargalo.travadas === 1 ? "OS parada" : "OS paradas"} há mais de 7 dias
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Mediana de {dias(gargalo.mediana_dias)} nessa etapa
                    {gargalo.atrasadas > 0 ? (
                      <>
                        {" "}
                        e{" "}
                        <span className="font-bold text-destructive">
                          {gargalo.atrasadas}{" "}
                          {gargalo.atrasadas === 1 ? "já passou" : "já passaram"} do prazo
                        </span>
                        .
                      </>
                    ) : (
                      ", nenhuma passou do prazo ainda."
                    )}
                  </p>
                  {/* Só aparece quando o status tem setor conhecido — "quem
                      destrava é —" não ajuda ninguém. */}
                  {setorDe(gargalo.status) !== "—" && (
                    <p className="text-xs text-muted-foreground">
                      Quem destrava é {setorDe(gargalo.status)}.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              label="OS paradas"
              value={totalParadas}
              icon={Clock}
              tone="cyan"
              hint="Esperando alguém agir"
            />
            <KpiCard
              label="Há mais de 7 dias"
              value={totalVelhas}
              icon={TimerOff}
              tone={totalVelhas > 0 ? "amber" : "muted"}
              hint={totalVelhas > 0 ? "Encalhadas" : "Nada encalhado"}
            />
            <KpiCard
              label="Fora do prazo"
              value={totalAtrasadas}
              icon={AlertTriangle}
              tone={totalAtrasadas > 0 ? "magenta" : "muted"}
              hint={totalAtrasadas > 0 ? "O cliente já esperou demais" : "Todas no prazo"}
            />
          </div>

          {/* 2. Agora, por etapa. */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                Agora, por etapa
              </h2>
              <span className="text-xs text-muted-foreground">
                {totalParadas} OS no total
              </span>
            </div>

            {/* A faixa: cada pedaço cresce na proporção das OS paradas.
                `flexGrow` com `flexBasis: 0` é proporção exata; o minWidth
                serve só para a fatia de 1 OS não sumir do olho. */}
            <div
              className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`Distribuição das ${totalParadas} OS paradas por etapa`}
            >
              {etapas.map((e) => (
                <div
                  key={e.status}
                  className={corDoStatus(e.status)}
                  style={{ flexGrow: e.paradas, flexBasis: 0, minWidth: "0.5rem" }}
                  title={`${rotuloDe(e.status)}: ${e.paradas} de ${totalParadas}`}
                />
              ))}
            </div>

            {/* No celular a fila de cartões rola de lado com encaixe; no desktop
                vira grade e o scroll horizontal desaparece. */}
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-2 md:overflow-visible md:pb-0 lg:grid-cols-3">
              {etapas.map((e) => (
                <div
                  key={e.status}
                  className="w-56 shrink-0 snap-start rounded-xl border border-border bg-card p-4 md:w-auto"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${corDoStatus(e.status)}`}
                    />
                    <span className="truncate text-sm font-bold text-foreground">
                      {rotuloDe(e.status)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold tracking-tight text-foreground">
                      {e.paradas}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {e.paradas === 1 ? "OS parada" : "OS paradas"}
                    </span>
                  </div>
                  <dl className="mt-3 space-y-1 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">mediana</dt>
                      <dd className="font-mono font-bold">{dias(e.mediana_dias)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">+7 dias</dt>
                      <dd
                        className={`font-mono font-bold ${
                          e.mais_de_7_dias > 0
                            ? "text-amber-600 dark:text-amber-500"
                            : "text-muted-foreground"
                        }`}
                      >
                        {e.mais_de_7_dias}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">atrasadas</dt>
                      <dd
                        className={`font-mono font-bold ${
                          e.atrasadas > 0 ? "text-destructive" : "text-muted-foreground"
                        }`}
                      >
                        {e.atrasadas}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">pior caso</dt>
                      <dd className="font-mono font-bold">{dias(e.pior_caso)}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </section>

          {/* 3. As mais presas — o nome e o número da OS, para agir hoje. */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              As mais presas
            </h2>

            <DataPanel
              rodape={
                <>
                  <span>
                    {presas.length} OS — as que estão paradas há mais tempo (no máximo 20)
                  </span>
                  {data?.gerado_em && (
                    <span className="font-mono">
                      {new Date(data.gerado_em).toLocaleString("pt-BR")}
                    </span>
                  )}
                </>
              }
            >
              {/* Celular: cartões, o cartão inteiro é o alvo de toque. */}
              <ul className="divide-y divide-border md:hidden">
                {presas.length === 0 && (
                  <li className="p-4 text-center text-xs text-muted-foreground">
                    Nenhuma OS parada
                  </li>
                )}
                {presas.map((o) => (
                  <li key={o.os_id}>
                    <Link
                      to="/os/$id"
                      params={{ id: o.os_id }}
                      className="flex min-h-14 items-center gap-3 px-3 py-3 active:bg-foreground/5"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="truncate text-sm font-bold text-foreground">
                          <span className="mr-2 font-mono text-xs font-normal text-[color:var(--bex-cyan)]">
                            #{o.numero}
                          </span>
                          {o.titulo || "Sem título"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {o.cliente || "Sem cliente"}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusChip label={rotuloDe(o.status)} tone="muted" />
                          {o.atrasada && <StatusChip label="Atrasada" tone="magenta" />}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`text-lg font-bold ${
                            o.dias_parada > 7
                              ? "text-amber-600 dark:text-amber-500"
                              : "text-foreground"
                          }`}
                        >
                          {dias(o.dias_parada)}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          parada
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Título</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead>Parada há</TableHead>
                    <TableHead>Prazo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {presas.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        Nenhuma OS parada
                      </TableCell>
                    </TableRow>
                  )}
                  {presas.map((o) => (
                    <TableRow key={o.os_id}>
                      <TableCell>
                        <Link
                          to="/os/$id"
                          params={{ id: o.os_id }}
                          className="font-mono text-xs text-[color:var(--bex-cyan)]"
                        >
                          #{o.numero}
                        </Link>
                      </TableCell>
                      <TableCell className="font-bold text-foreground">
                        <Link to="/os/$id" params={{ id: o.os_id }}>
                          {o.titulo || "Sem título"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {o.cliente || "—"}
                      </TableCell>
                      <TableCell>
                        <StatusChip label={rotuloDe(o.status)} tone="muted" />
                      </TableCell>
                      <TableCell
                        className={`font-bold ${
                          o.dias_parada > 7
                            ? "text-amber-600 dark:text-amber-500"
                            : "text-foreground"
                        }`}
                      >
                        {dias(o.dias_parada)}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          {formatarData(o.prazo_entrega)}
                          {o.atrasada && <StatusChip label="Atrasada" tone="magenta" />}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DataPanel>
          </section>

          {/* A régua, escrita por extenso: número de gargalo sem a régua ao lado
              vira discussão, e é a equipe que aparece na lista. */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-bold text-foreground">Como a conta é feita</p>
            <p className="mt-1">
              O tempo conta desde que a OS <strong>entrou na etapa em que está agora</strong>,
              e isso vem do histórico de status — não do <code>updated_at</code>. O{" "}
              <code>updated_at</code> muda a cada edição: corrigir um telefone do cliente
              zeraria o relógio de uma OS parada há três semanas e o gargalo sumiria da tela
              sem que nada tivesse andado.
            </p>
            <p className="mt-2">
              Espera com o cliente <strong>não</strong> conta como gargalo. Aprovação de arte,
              aguardando retirada e aguardando entrega ficam fora da escolha do gargalo porque
              quem destrava está do lado de fora da oficina — cobrar a equipe por isso é
              cobrar pelo telefone do cliente. Elas continuam na lista das mais presas, para
              alguém ligar.
            </p>
            <p className="mt-2">
              Só entram OS vivas: concluída, faturada e cancelada ficam de fora. "Atrasada" é
              prazo de entrega no passado, coisa diferente de "parada há muito tempo" — uma OS
              pode estar parada há dez dias e ainda dentro do prazo.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
