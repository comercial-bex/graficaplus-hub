import { useEffect, useRef } from "react";
import { Bot, Clock, Loader2, Search, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  agruparPorDia,
  horaCurta,
  iniciais,
  nomeDaConversa,
  resumoDaConversa,
  telefoneLegivel,
  type AbaStatus,
  type ConversaDaCaixa,
  type Fila,
} from "@/domain/whatsapp/caixa-de-entrada";
import type { ContagemDaFila, PessoaDaEquipe } from "@/components/whatsapp/usar-caixa-de-entrada";
import {
  SETORES,
  corDaEspera,
  esperaDe,
  infoDoSetor,
  type FiltroDeSetor,
} from "@/domain/whatsapp/filas";

const ABAS: { valor: AbaStatus; rotulo: string }[] = [
  { valor: "aberta", rotulo: "Abertas" },
  { valor: "pendente", rotulo: "Pendentes" },
  { valor: "resolvida", rotulo: "Resolvidas" },
];

const FILAS: { valor: Fila; rotulo: string }[] = [
  { valor: "minhas", rotulo: "Minhas" },
  { valor: "nao_atribuidas", rotulo: "Não atribuídas" },
  { valor: "todas", rotulo: "Todas" },
];

function estaAbertaOuPendente(s: string): boolean {
  return s === "aberta" || s === "pendente";
}

/** Cor discreta e estável por etiqueta (mesma etiqueta, mesma cor). */
function corDaEtiqueta(e: string): string {
  const cores = ["text-status-cyan", "text-status-magenta", "text-status-amber", "text-status-positive"];
  let h = 0;
  for (const ch of e) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return cores[h % cores.length];
}

export type Contadores = {
  minhas: number;
  nao_atribuidas: number;
  todas: number;
  aberta: number;
  pendente: number;
  resolvida: number;
};

function vazio(fila: Fila, status: AbaStatus, busca: string, setor: FiltroDeSetor): string {
  if (busca.trim()) return "Nenhuma conversa com esse termo. Tente o telefone só com números.";
  if (setor !== "todas" && setor !== "minhas_filas" && status === "aberta") {
    return `Nenhuma conversa aberta em ${infoDoSetor(setor).rotulo}. Veja “Todas” para as outras filas.`;
  }
  if (fila === "nao_atribuidas") return "Nenhuma conversa não atribuída — tudo em dia.";
  if (fila === "minhas") return "Nenhuma conversa com você. Assuma uma em “Não atribuídas”.";
  if (status === "pendente") return "Nenhuma conversa pendente.";
  if (status === "resolvida") return "Nenhuma conversa resolvida ainda.";
  return "Nenhuma conversa aberta — quando um cliente escrever, ela aparece aqui.";
}

/** A coluna da esquerda: filas, situação, busca e as conversas por dia. */
export function ListaDeConversas({
  conversas,
  carregando,
  temMais,
  carregandoMais,
  onCarregarMais,
  contadores,
  equipe,
  selecionadaId,
  onSelecionar,
  busca,
  onBusca,
  fila,
  onFila,
  status,
  onStatus,
  setor,
  onSetor,
  contagemPorFila,
  naoLidasPorMim,
  className,
}: {
  /** Caixa v3: o setor filtrado, a contagem de cada um e as não lidas de quem olha. */
  setor: FiltroDeSetor;
  onSetor: (s: FiltroDeSetor) => void;
  contagemPorFila: ContagemDaFila[] | undefined;
  naoLidasPorMim: Map<string, number> | undefined;
  conversas: ConversaDaCaixa[];
  carregando: boolean;
  temMais: boolean;
  carregandoMais: boolean;
  onCarregarMais: () => void;
  contadores: Contadores | undefined;
  equipe: PessoaDaEquipe[];
  selecionadaId: string | null;
  onSelecionar: (id: string) => void;
  busca: string;
  onBusca: (v: string) => void;
  fila: Fila;
  onFila: (f: Fila) => void;
  status: AbaStatus;
  onStatus: (s: AbaStatus) => void;
  className?: string;
}) {
  const sentinela = useRef<HTMLDivElement>(null);
  const pessoas = new Map(equipe.map((p) => [p.id, p]));

  // "Carregar mais" ao rolar: quando o fim da lista aparece, busca a próxima página.
  useEffect(() => {
    const el = sentinela.current;
    if (!el || !temMais) return;
    const obs = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting) && !carregandoMais) onCarregarMais();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [temMais, carregandoMais, onCarregarMais]);

  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Nome, telefone ou mensagem…"
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
            aria-label="Buscar conversa"
          />
        </div>
        {/* Setores: as filas da pessoa (padrão), todas, ou uma. O número é
            de conversas abertas ou pendentes naquela fila. */}
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Filas por setor">
          {(["minhas_filas", "todas"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={setor === v}
              onClick={() => onSetor(v)}
              className={cn(
                "shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                setor === v
                  ? "border-foreground/30 bg-foreground/10 font-semibold text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {v === "minhas_filas" ? "Minhas filas" : "Todas as filas"}
            </button>
          ))}
          {SETORES.map((s) => {
            const n = contagemPorFila?.find((c) => c.fila === s.valor);
            const ativo = setor === s.valor;
            return (
              <button
                key={s.valor}
                type="button"
                aria-pressed={ativo}
                onClick={() => onSetor(s.valor)}
                title={n ? `${n.abertas} aberta(s), ${n.aguardando} esperando resposta` : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                  ativo ? cn(s.cor, "font-semibold") : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", s.ponto)} aria-hidden />
                {s.rotulo}
                {n && n.abertas > 0 && <span className="font-mono">{n.abertas}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Responsável">
          {FILAS.map((f) => (
            <button
              key={f.valor}
              type="button"
              aria-pressed={fila === f.valor}
              onClick={() => onFila(f.valor)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                fila === f.valor
                  ? "border-foreground/30 bg-foreground/10 font-semibold text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {f.rotulo}
              {f.valor === "nao_atribuidas" && contadores && (
                <span className="ml-1 font-mono">{contadores.nao_atribuidas}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-1 border-b" role="tablist" aria-label="Situação">
          {ABAS.map((a) => (
            <button
              key={a.valor}
              type="button"
              role="tab"
              aria-selected={status === a.valor}
              onClick={() => onStatus(a.valor)}
              className={cn(
                "-mb-px flex-1 border-b-2 px-1 py-1.5 text-xs font-medium transition-colors",
                status === a.valor
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {a.rotulo}
              {contadores && <span className="ml-1 font-mono text-[10px]">{contadores[a.valor]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {carregando ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : conversas.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{vazio(fila, status, busca, setor)}</p>
        ) : (
          agruparPorDia(conversas).map(({ grupo, itens }) => (
            <div key={grupo}>
              <div className="sticky top-0 z-10 bg-card/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                {grupo}
              </div>
              {itens.map((c) => {
                const nome = nomeDaConversa(c);
                // As de quem olha, quando já carregou; senão, o contador geral.
                const naoLidas = naoLidasPorMim ? (naoLidasPorMim.get(c.id) ?? 0) : (c.nao_lidas ?? 0);
                const resp = c.responsavel_id ? pessoas.get(c.responsavel_id) : null;
                const espera =
                  c.status === "aberta" || c.status === "pendente" ? esperaDe(c.aguardando_desde) : null;
                const setorDaConversa = c.fila ? infoDoSetor(c.fila) : null;
                const comAssistente = c.modo === "auto" && !c.responsavel_id && estaAbertaOuPendente(c.status);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelecionar(c.id)}
                    aria-current={selecionadaId === c.id ? "true" : undefined}
                    className={cn(
                      "relative w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                      selecionadaId === c.id && "bg-muted",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="text-xs">{iniciais(nome)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2">
                          <span className={cn("truncate text-sm", naoLidas > 0 ? "font-bold" : "font-medium")}>
                            {nome}
                          </span>
                          <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                            {espera && (
                              <span
                                className={cn("inline-flex items-center gap-0.5 font-semibold", corDaEspera(espera.nivel))}
                                title={`O cliente espera resposta há ${espera.texto}`}
                              >
                                <Clock className="h-3 w-3" aria-hidden />
                                {espera.texto}
                              </span>
                            )}
                            {horaCurta(c.ultima_mensagem_at)}
                          </span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {resumoDaConversa(c.ultima_mensagem)}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          {setorDaConversa && setor !== c.fila && (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
                              title={`Fila ${setorDaConversa.rotulo}`}
                            >
                              <span className={cn("h-1.5 w-1.5 rounded-full", setorDaConversa.ponto)} aria-hidden />
                              {setorDaConversa.rotulo}
                            </span>
                          )}
                          {comAssistente && (
                            <Bot className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Com a assistente">
                              <title>Com a assistente</title>
                            </Bot>
                          )}
                          <span className="truncate text-[10px] text-muted-foreground">
                            {c.cliente ? c.cliente.nome : telefoneLegivel(c.telefone)}
                          </span>
                          {c.status === "arquivada" && (
                            <span className="text-[10px] text-muted-foreground">· arquivada</span>
                          )}
                          {(c.etiquetas ?? []).slice(0, 3).map((e) => (
                            <Tag key={e} className={cn("h-3 w-3 shrink-0", corDaEtiqueta(e))} aria-label={`Etiqueta ${e}`}>
                              <title>{e}</title>
                            </Tag>
                          ))}
                          <span className="ml-auto flex items-center gap-1">
                            {naoLidas > 0 && (
                              <span
                                className="rounded-full bg-positive px-1.5 text-[10px] font-semibold leading-4 text-positive-foreground"
                                aria-label={`${naoLidas} não lida(s)`}
                              >
                                {naoLidas}
                              </span>
                            )}
                            {resp && (
                              <Avatar className="h-5 w-5" title={`Responsável: ${resp.nome ?? ""}`}>
                                {resp.avatar_url && <AvatarImage src={resp.avatar_url} alt="" />}
                                <AvatarFallback className="text-[8px]">{iniciais(resp.nome)}</AvatarFallback>
                              </Avatar>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))
        )}
        <div ref={sentinela} />
        {carregandoMais && (
          <div className="flex justify-center p-3 text-xs text-muted-foreground">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Carregando mais…
          </div>
        )}
        {temMais && !carregandoMais && (
          <button type="button" onClick={onCarregarMais} className="w-full p-3 text-xs text-muted-foreground hover:underline">
            Carregar mais conversas
          </button>
        )}
      </div>
    </Card>
  );
}
