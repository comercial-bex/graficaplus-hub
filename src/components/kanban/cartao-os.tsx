import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ROTULO_DA_FINALIDADE, type FinalidadeDaOS } from "@/domain/os/finalidade";
import { StatusChip } from "@/components/bex/StatusChip";
import { areaEmTexto, resumoDaProducao } from "@/domain/os/o-que-produzir";
import { paradaHa, prazoEmPalavras } from "@/domain/os/prazo";
import { semCapa } from "@/domain/os/arquivos-da-os";
import { AlertTriangle, FileImage, Layers, Lock } from "lucide-react";
import { SeloDaMaquina } from "@/components/kanban/icone-da-maquina";
import { TrilhaDaOs } from "@/components/kanban/trilha-da-os";
import { identidadeDaMaquina } from "@/domain/producao/identidade-da-maquina";

/**
 * O cartão do quadro.
 *
 * Redesenhado em 23/10/2026 a pedido do dono. O cartão responde, nesta ordem:
 *
 *   1. O QUE É — a capa: a imagem do arquivo que vai ser impresso (o final de
 *      produção quando há, senão a arte mais recente). Sem imagem, o tipo do
 *      arquivo ("PDF", "CDR") ou "Sem arte" — dizer que falta arte é informação.
 *   2. ONDE ESTÁ — a trilha das seis etapas (entrada, arte, fila, produção,
 *      acabamento, saída), as mesmas do quadro e, agrupadas, da TV da oficina.
 *   3. O QUE FALTA — as pendências, numa linha só: o nome da primeira e quantas
 *      mais. Antes era uma faixa amarela com a pendência por extenso em todo
 *      cartão, o tempo todo; o "como resolver" de cada uma está na ficha.
 *
 * E ele ABRE: clicar em qualquer lugar abre a ficha; o arrasto continua porque
 * o sensor só ativa depois de 5px (mouse) ou 250 ms (toque).
 *
 * Histórico: antes mostrava "Produto não definido", "Máquina não definida", "0
 * anexo(s)", "Arte: Pendente" — seis linhas, cinco delas de campo vazio. Campo
 * vazio não vira linha.
 */

export type BloqueioOs = { codigo: string; titulo: string; resolver: string };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const primeiroNome = (nome: string | null | undefined) => (nome ?? "").trim().split(/\s+/)[0] || "?";

export function CartaoOs({
  os,
  canSeePrices,
  bloqueios = [],
  dragging,
  onAbrir,
}: {
  os: any;
  /** Vê preço de venda. O cartão só mostra o valor da OS — nunca custo nem margem. */
  canSeePrices?: boolean;
  bloqueios?: BloqueioOs[];
  dragging?: boolean;
  onAbrir?: () => void;
}) {
  const prazo = prazoEmPalavras(os.prazo_entrega);
  const atrasada = prazo?.tom === "magenta";
  const producao = resumoDaProducao(os.itens);
  // "Parada há" conta da última troca de etapa (os_status_historico), não do
  // updated_at — que muda com qualquer edição da ficha.
  const parada = paradaHa(os.ultimo_movimento?.mudou_em ?? os.updated_at);
  const responsaveis = [os.designer, os.operador].filter(Boolean);
  const pausada = os.status === "pausado";
  const maquina = identidadeDaMaquina(os);
  const interna = os.finalidade && os.finalidade !== "venda";

  return (
    <Card
      onClick={onAbrir}
      className={`relative cursor-pointer overflow-hidden bg-card transition-colors hover:border-[color:var(--bex-cyan)]/50 ${
        dragging ? "rotate-1 shadow-[0_0_24px_-6px_rgba(0,212,255,0.5)]" : ""
      } ${atrasada ? "border-[color:var(--bex-magenta)]/60" : ""}`}
    >
      <Capa os={os}>
        {/* Número e avisos na MESMA linha: antes cada um era posicionado no seu canto e,
            numa coluna estreita, o aviso ("vence amanhã", "2 dias de atraso") cobria o
            número da OS. Agora o aviso desce para a linha de baixo quando não cabe. */}
        <div className="absolute inset-x-2 top-2 flex flex-wrap items-start gap-1">
          <span className="shrink-0 rounded-md bg-background/85 px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground backdrop-blur md:text-[11px]">
            #{os.numero}
          </span>
          <div className="ml-auto flex min-w-0 flex-wrap justify-end gap-1">
            {pausada && <StatusChip compacto label="Pausada" tone="muted" />}
            {prazo && prazo.tom !== "muted" && (
              <StatusChip
                compacto
                label={prazo.texto}
                tone={prazo.tom === "magenta" ? "magenta" : "amber"}
              />
            )}
          </div>
        </div>
        <div className={`absolute inset-x-0 bottom-0 h-1 ${PRIO_COR[os.prioridade] ?? "bg-muted"}`} aria-hidden />
      </Capa>

      <div className="space-y-2 p-3">
        <div>
          <div className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{os.titulo}</div>
          {interna ? (
            // OS interna: o "cliente" é a casa — o que importa é para que é.
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline">{ROTULO_DA_FINALIDADE[os.finalidade as FinalidadeDaOS] ?? os.finalidade}</Badge>
              {os.local_mostruario && <span className="truncate">{os.local_mostruario}</span>}
            </div>
          ) : (
            os.cliente_nome && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                {os.cliente_logo_url && (
                  <Avatar className="h-4 w-4">
                    <AvatarImage src={os.cliente_logo_url} />
                    <AvatarFallback className="text-[8px]">{os.cliente_nome.charAt(0)}</AvatarFallback>
                  </Avatar>
                )}
                <span className="truncate">{os.cliente_nome}</span>
              </div>
            )
          )}
        </div>

        {/* O que vai ser produzido. */}
        {producao && (
          <div className="flex items-start gap-1.5 text-xs leading-snug text-foreground/85 md:text-[11px]">
            <Layers className="mt-px h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="line-clamp-2">
              {producao.linha}
              {producao.extras > 0 && <span className="text-muted-foreground"> · +{producao.extras} item(ns)</span>}
              {areaEmTexto(producao.areaTotal) && (
                <span className="font-mono text-muted-foreground"> · {areaEmTexto(producao.areaTotal)}</span>
              )}
            </span>
          </div>
        )}

        {/* Onde está: a trilha das seis etapas, e o passo exato dentro da etapa. */}
        <TrilhaDaOs status={os.status} compacta />

        {(maquina || parada) && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs md:text-[10px]">
            {/* O selo diz o caminho (qual máquina); a trilha acima já diz o passo. */}
            {maquina && <SeloDaMaquina identidade={maquina} />}
            {parada && <span className="font-mono text-muted-foreground">parada há {parada}</span>}
          </div>
        )}

        {/* O que impede de avançar, numa linha: o nome da primeira e quantas mais.
            O "como resolver" de cada uma está na ficha. */}
        {bloqueios.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-[color:var(--bex-amber)] md:text-[10px]">
            <Lock className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{bloqueios[0].titulo}</span>
            {bloqueios.length > 1 && <span className="shrink-0 font-semibold">+{bloqueios.length - 1}</span>}
            <span className="sr-only">{bloqueios.map((b) => b.titulo).join(", ")}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {responsaveis.length > 0 && (
              <div className="flex shrink-0 -space-x-1.5" aria-hidden>
                {responsaveis.map((r: any) => (
                  <Avatar key={r.id} className="h-5 w-5 border border-background">
                    <AvatarImage src={r.avatar_url ?? undefined} />
                    <AvatarFallback className="text-[9px]">{r.nome?.charAt(0)}</AvatarFallback>
                  </Avatar>
                ))}
              </div>
            )}
            {responsaveis.length > 0 ? (
              <span className="truncate text-xs text-muted-foreground md:text-[10px]">
                {responsaveis.map((r: any) => primeiroNome(r.nome)).join(" · ")}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground md:text-[10px]">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                sem designer nem operador
              </span>
            )}
          </div>
          {canSeePrices && Number(os.valor_total) > 0 && (
            <span className="font-mono text-xs text-[color:var(--bex-lime)]">{brl(Number(os.valor_total))}</span>
          )}
        </div>

        {/* Quem mexeu por último e quando — todos movem, e o registro fica à vista.
            De onde veio também: "Produção → Arte" é retrabalho. */}
        {os.ultimo_movimento?.rotulo && (
          <div className="line-clamp-2 font-mono text-xs text-muted-foreground md:text-[10px]">
            {os.ultimo_movimento.verbo ?? "movida"} por {os.ultimo_movimento.rotulo}
            {os.ultimo_movimento.passo && <> · {os.ultimo_movimento.passo}</>}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * A capa: a imagem da arte, ou — sem imagem que o navegador desenhe — o tipo do
 * arquivo ou "Sem arte". `loading="lazy"` e proporção fixa: o quadro tem dezenas
 * de cartões e a imagem não pode empurrar o cartão quando chega.
 */
function Capa({ os, children }: { os: any; children?: React.ReactNode }) {
  const [quebrou, setQuebrou] = useState(false);
  const url: string | null = os.capa_url ?? null;
  const semArquivo = semCapa(os.arquivos);
  // "RIP sem OS" é a impressão que saiu direto no RIP e foi lançada depois: a OS
  // nasce sem arte POR NATUREZA (o arquivo é o próprio nome do trabalho). Dizer
  // "Sem arte" nelas fazia 14 cartões concluídos parecerem trabalho faltando.
  const avulsa = semArquivo.rotulo === "Sem arte" && /^RIP sem OS\b/i.test(String(os.titulo ?? ""));
  const falta = avulsa ? { rotulo: "Impressão avulsa", detalhe: "feita direto no RIP" } : semArquivo;
  const temImagem = Boolean(url && !quebrou);
  return (
    // Sem imagem a capa ganha altura mínima: o cabeçalho (número + aviso, que pode
    // quebrar em duas linhas) mora no alto e o "Sem arte" fica embaixo, sem um cobrir o outro.
    <div className={`relative aspect-[16/9] w-full overflow-hidden bg-muted/60 ${temImagem ? "" : "min-h-[104px]"}`}>
      {url && !quebrou ? (
        <img
          src={url}
          alt={`Arte da OS ${os.numero}: ${os.titulo}`}
          loading="lazy"
          draggable={false}
          onError={() => setQuebrou(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-end gap-0.5 pb-2 text-muted-foreground">
          <FileImage className="h-6 w-6 opacity-60" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wider">{quebrou ? "Imagem indisponível" : falta.rotulo}</span>
          {falta.detalhe && <span className="max-w-[90%] truncate text-[10px]">{falta.detalhe}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

const PRIO_COR: Record<number, string> = {
  1: "bg-[color:var(--bex-magenta)]",
  2: "bg-amber-400",
  3: "bg-[color:var(--bex-cyan)]",
  4: "bg-muted-foreground/40",
  5: "bg-muted-foreground/30",
};
