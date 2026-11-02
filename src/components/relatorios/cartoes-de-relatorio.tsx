import { useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  Factory,
  Hourglass,
  MessageSquare,
  Percent,
  Receipt,
  RotateCcw,
  Scale,
  Star,
  Timer,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  alternarFavorito,
  armazemDoNavegador,
  chaveDosFavoritos,
  gravarFavoritos,
  lerFavoritos,
} from "@/domain/favoritos-no-aparelho";

/**
 * Os relatórios como cartões, no jeito do Holdprint (01/11/2026): um desenho
 * por relatório, uma linha dizendo para que serve, estrela de favorito e
 * filtros por área. Tocar no cartão desce até a tabela daquele relatório, que
 * continua onde sempre esteve. O dono enxerga mal e está ensinando gente nova:
 * achar "OS atrasadas" por um relógio vermelho é mais rápido que ler dez
 * títulos de tabela.
 */

export type CategoriaDoRelatorio = "financeiro" | "producao" | "whatsapp";

export type Relatorio = {
  chave: string;
  titulo: string;
  /** Uma linha, como o Holdprint faz: "Valores a receber por vencimento". */
  descricao: string;
  categoria: CategoriaDoRelatorio;
  icone: LucideIcon;
  /** `id` da tabela na página, para o cartão rolar até ela. */
  ancora: string;
};

export const PREFIXO_DOS_FAVORITOS_DE_RELATORIO = "bexprint:relatorios:favoritos";

export const RELATORIOS: readonly Relatorio[] = [
  { chave: "faturamento", titulo: "Faturamento por período", descricao: "Quanto entrou de venda em cada mês", categoria: "financeiro", icone: TrendingUp, ancora: "relatorio-faturamento" },
  { chave: "lucro-por-os", titulo: "Lucro por OS", descricao: "O que sobrou de cada ordem de serviço", categoria: "financeiro", icone: Receipt, ancora: "relatorio-lucro-por-os" },
  { chave: "previsto-x-realizado", titulo: "Previsto × realizado", descricao: "Orçado contra o que custou de verdade", categoria: "financeiro", icone: Scale, ancora: "relatorio-previsto-x-realizado" },
  { chave: "margem-por-produto", titulo: "Margem por produto", descricao: "Quais produtos dão mais e menos margem", categoria: "financeiro", icone: Percent, ancora: "relatorio-margem-por-produto" },
  { chave: "os-atrasadas", titulo: "OS atrasadas", descricao: "Ordens que passaram do prazo prometido", categoria: "producao", icone: AlarmClock, ancora: "relatorio-os-atrasadas" },
  { chave: "retrabalho", titulo: "Retrabalho por setor", descricao: "Onde o trabalho volta para refazer", categoria: "producao", icone: RotateCcw, ancora: "relatorio-retrabalho" },
  { chave: "producao-por-maquina", titulo: "Produção por máquina", descricao: "Quanto cada máquina produziu no período", categoria: "producao", icone: Factory, ancora: "relatorio-producao-por-maquina" },
  { chave: "tempo-por-etapa", titulo: "Tempo médio por etapa", descricao: "Quanto a OS fica parada em cada etapa", categoria: "producao", icone: Timer, ancora: "relatorio-tempo-por-etapa" },
  { chave: "conversas-abertas", titulo: "Conversas WhatsApp abertas", descricao: "Atendimentos sem resposta ou sem fechar", categoria: "whatsapp", icone: MessageSquare, ancora: "relatorio-conversas-abertas" },
  { chave: "tempo-de-resposta", titulo: "Tempo médio de resposta", descricao: "Quanto o cliente espera a primeira resposta", categoria: "whatsapp", icone: Hourglass, ancora: "relatorio-tempo-de-resposta" },
];

export type FiltroDeRelatorio = "todos" | "favoritos" | CategoriaDoRelatorio;

export const ROTULO_DA_CATEGORIA: Record<CategoriaDoRelatorio, string> = {
  financeiro: "Financeiro",
  producao: "Produção",
  whatsapp: "WhatsApp",
};

/** Os relatórios que esta pessoa pode ver: o financeiro só com permissão de ver dinheiro. */
export function relatoriosDisponiveis(verFinanceiro: boolean, lista: readonly Relatorio[] = RELATORIOS): Relatorio[] {
  return lista.filter((r) => verFinanceiro || r.categoria !== "financeiro");
}

/** O que a grade mostra para um filtro; favoritos vêm na ordem da estrela (mais recente primeiro). */
export function relatoriosNoFiltro(
  disponiveis: readonly Relatorio[],
  filtro: FiltroDeRelatorio,
  favoritos: readonly string[],
): Relatorio[] {
  if (filtro === "favoritos") {
    return favoritos.map((f) => disponiveis.find((r) => r.chave === f)).filter((r): r is Relatorio => !!r);
  }
  if (filtro === "todos") return [...disponiveis];
  return disponiveis.filter((r) => r.categoria === filtro);
}

/** Os chips com contagem, na ordem do Holdprint: Favoritos, Todos e depois as áreas que existem. */
export function chipsDoFiltro(
  disponiveis: readonly Relatorio[],
  favoritos: readonly string[],
): { filtro: FiltroDeRelatorio; rotulo: string; quantidade: number }[] {
  const favoritosVisiveis = favoritos.filter((f) => disponiveis.some((r) => r.chave === f)).length;
  const chips: { filtro: FiltroDeRelatorio; rotulo: string; quantidade: number }[] = [
    { filtro: "favoritos", rotulo: "Favoritos", quantidade: favoritosVisiveis },
    { filtro: "todos", rotulo: "Todos", quantidade: disponiveis.length },
  ];
  for (const categoria of ["financeiro", "producao", "whatsapp"] as const) {
    const n = disponiveis.filter((r) => r.categoria === categoria).length;
    if (n > 0) chips.push({ filtro: categoria, rotulo: ROTULO_DA_CATEGORIA[categoria], quantidade: n });
  }
  return chips;
}

const COR_DA_CATEGORIA: Record<CategoriaDoRelatorio, string> = {
  financeiro: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  producao: "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100",
  whatsapp: "bg-violet-100 text-violet-900 dark:bg-violet-950/40 dark:text-violet-100",
};

/** O desenho do cartão: disco na cor da área com o ícone grande. Decorativo; o título diz o que é. */
function DiscoDoRelatorio({ relatorio }: { relatorio: Relatorio }) {
  const Icone = relatorio.icone;
  return (
    <span
      aria-hidden="true"
      data-disco={relatorio.categoria}
      className={cn("grid h-16 w-16 shrink-0 place-items-center rounded-full", COR_DA_CATEGORIA[relatorio.categoria])}
    >
      <Icone className="h-8 w-8" strokeWidth={1.8} />
    </span>
  );
}

export function CartoesDeRelatorio({ verFinanceiro }: { verFinanceiro: boolean }) {
  const { user } = useAuth();
  const chave = chaveDosFavoritos(PREFIXO_DOS_FAVORITOS_DE_RELATORIO, user?.email);
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [filtro, setFiltro] = useState<FiltroDeRelatorio>("todos");
  useEffect(() => setFavoritos(lerFavoritos(chave, armazemDoNavegador())), [chave]);

  const disponiveis = useMemo(() => relatoriosDisponiveis(verFinanceiro), [verFinanceiro]);
  const chips = chipsDoFiltro(disponiveis, favoritos);
  const naGrade = relatoriosNoFiltro(disponiveis, filtro, favoritos);

  const alternarEstrela = (chaveDoRelatorio: string) =>
    setFavoritos((atual) => {
      const nova = alternarFavorito(atual, chaveDoRelatorio);
      gravarFavoritos(chave, nova, armazemDoNavegador());
      return nova;
    });

  const irAte = (ancora: string) => {
    const alvo = document.getElementById(ancora);
    if (!alvo) return;
    alvo.scrollIntoView({ behavior: "smooth", block: "start" });
    // Leva o foco junto, para o leitor de tela e o teclado saberem onde estão.
    if (!alvo.hasAttribute("tabindex")) alvo.setAttribute("tabindex", "-1");
    alvo.focus({ preventScroll: true });
  };

  return (
    <section className="space-y-3" aria-label="Relatórios disponíveis" data-testid="cartoes-de-relatorio">
      <div role="group" aria-label="Filtrar relatórios" className="flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const ativo = filtro === c.filtro;
          return (
            <button
              key={c.filtro}
              type="button"
              aria-pressed={ativo}
              onClick={() => setFiltro(c.filtro)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors sm:min-h-9",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ativo ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-foreground hover:border-primary/50",
              )}
            >
              {c.filtro === "favoritos" && <Star className="h-3.5 w-3.5" aria-hidden="true" />}
              {c.rotulo}
              <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{c.quantidade}</span>
            </button>
          );
        })}
      </div>

      {naGrade.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Nenhum favorito ainda. Toque na estrela de um relatório para ele aparecer aqui.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Cartões de relatório">
          {naGrade.map((r) => {
            const favorito = favoritos.includes(r.chave);
            return (
              <li key={r.chave} className="relative">
                <button
                  type="button"
                  onClick={() => irAte(r.ancora)}
                  data-relatorio={r.chave}
                  className={cn(
                    "flex h-full w-full flex-col items-start gap-3 rounded-xl border bg-card p-3 pr-12 text-left transition-colors hover:border-primary/50",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <DiscoDoRelatorio relatorio={r} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-snug">{r.titulo}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{r.descricao}</span>
                    <span className="mt-2 inline-block rounded border px-1.5 py-px text-xs text-muted-foreground">
                      {ROTULO_DA_CATEGORIA[r.categoria]}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={favorito}
                  aria-label={favorito ? `Tirar ${r.titulo} dos favoritos` : `Pôr ${r.titulo} nos favoritos`}
                  onClick={() => alternarEstrela(r.chave)}
                  className={cn(
                    "absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full border bg-card/95 transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    favorito ? "border-amber-500 text-amber-600" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Star className={cn("h-4 w-4", favorito && "fill-amber-400")} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
