import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/bex/StatusChip";
import { rotuloDe } from "@/domain/os/etapas";
import { areaEmTexto, resumoDaProducao } from "@/domain/os/o-que-produzir";
import { paradaHa, prazoEmPalavras } from "@/domain/os/prazo";
import { AlertTriangle, Layers, Lock } from "lucide-react";
import { SeloDaMaquina } from "@/components/kanban/icone-da-maquina";
import { identidadeDaMaquina, statusIndicaMaquina } from "@/domain/producao/identidade-da-maquina";

/**
 * O cartão do quadro.
 *
 * O que ele mostrava antes: "Produto não definido", "Máquina não definida",
 * "0 anexo(s)", "Arte: Pendente", "Fin.: Não lançado", "Última mov.: 07/09,
 * 00:03". Seis linhas, e cinco delas falavam de campo vazio. O que a OS de fato
 * manda produzir — os itens, com medida — não aparecia.
 *
 * Agora o cartão responde três perguntas, nesta ordem: o que é, em que pé está,
 * e o que impede de andar. Campo vazio não vira linha: silêncio ocupa menos
 * espaço do que "não definido" e diz a mesma coisa.
 *
 * E ele ABRE. Antes o corpo inteiro era alça de arrasto e só o `#44` levava a
 * algum lugar — um alvo de dez pixels. Agora clicar em qualquer lugar abre a
 * ficha; o arrasto continua funcionando porque o sensor só ativa depois de 5px
 * de movimento, e clique parado nunca vira arrasto.
 */

export type BloqueioOs = { codigo: string; titulo: string; resolver: string };

// O cartão escrevia "R$ 340.00" — ponto decimal, formato de planilha em inglês.
// O resto do sistema já usa o mesmo `brl`.
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CartaoOs({
  os,
  canSeeFinancials,
  bloqueios = [],
  dragging,
  onAbrir,
}: {
  os: any;
  canSeeFinancials?: boolean;
  bloqueios?: BloqueioOs[];
  dragging?: boolean;
  onAbrir?: () => void;
}) {
  const prazo = prazoEmPalavras(os.prazo_entrega);
  const atrasada = prazo?.tom === "magenta";
  const producao = resumoDaProducao(os.itens);
  const parada = paradaHa(os.updated_at);
  const responsaveis = [os.designer, os.operador].filter(Boolean);
  const pausada = os.status === "pausado";
  // Vem da máquina vinculada quando existe; do status quando ninguém escolheu
  // ainda. Ver domain/producao/identidade-da-maquina.
  const maquina = identidadeDaMaquina(os);

  return (
    <Card
      onClick={onAbrir}
      className={`relative cursor-pointer overflow-hidden bg-card p-3 transition-colors hover:border-[color:var(--bex-cyan)]/50 ${
        dragging ? "rotate-1 shadow-[0_0_24px_-6px_rgba(0,212,255,0.5)]" : ""
      } ${atrasada ? "border-[color:var(--bex-magenta)]/60" : ""}`}
    >
      <div
        className={`absolute bottom-0 left-0 top-0 w-1 ${PRIO_COR[os.prioridade] ?? "bg-muted"}`}
      />

      <div className="space-y-2 pl-1.5">
        <div className="flex items-start justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            #{os.numero}
          </span>
          <div className="flex flex-wrap justify-end gap-1">
            {pausada && <StatusChip label="Pausada" tone="muted" />}
            {prazo && prazo.tom !== "muted" && (
              <StatusChip label={prazo.texto} tone={prazo.tom === "magenta" ? "magenta" : "amber"} />
            )}
          </div>
        </div>

        <div className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
          {os.titulo}
        </div>

        {os.cliente_nome && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {os.cliente_logo_url && (
              <Avatar className="h-4 w-4">
                <AvatarImage src={os.cliente_logo_url} />
                <AvatarFallback className="text-[8px]">{os.cliente_nome.charAt(0)}</AvatarFallback>
              </Avatar>
            )}
            <span className="truncate">{os.cliente_nome}</span>
          </div>
        )}

        {/* O que vai ser produzido — a linha que faltava. */}
        {producao && (
          <div className="rounded border border-border/60 bg-muted/40 px-2 py-1.5">
            <div className="flex items-start gap-1.5 text-[11px] leading-snug text-foreground/85">
              <Layers className="mt-px h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="line-clamp-2">{producao.linha}</span>
            </div>
            <div className="mt-0.5 flex gap-2 pl-[18px] font-mono text-[10px] text-muted-foreground">
              {producao.extras > 0 && <span>+{producao.extras} item(ns)</span>}
              {areaEmTexto(producao.areaTotal) && <span>{areaEmTexto(producao.areaTotal)}</span>}
            </div>
          </div>
        )}

        {/* O status exato dentro da etapa: a coluna diz o estágio, o cartão diz
            o passo. É o que substituiu vinte e cinco colunas. E o selo da
            máquina diz o caminho, sem custar coluna nenhuma. */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          {/* Com o selo ao lado, "Laser / CNC · Laser CO2" é a mesma coisa dita
              duas vezes — e o selo é o mais específico. Já "Em produção ·
              Fiber" soma: estágio genérico mais a máquina. */}
          {!(maquina && statusIndicaMaquina(os.status)) && (
            <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-medium text-foreground/80">
              {rotuloDe(os.status)}
            </span>
          )}
          {maquina && <SeloDaMaquina identidade={maquina} />}
          {parada && (
            <span className="font-mono text-muted-foreground" title="Tempo desde a última mudança">
              parada há {parada}
            </span>
          )}
        </div>

        {/* O que impede de avançar — antes do arrasto, não depois do erro. */}
        {bloqueios.length > 0 && (
          <div
            className="flex items-center gap-1.5 rounded border border-[color:var(--bex-amber)]/30 bg-[color:var(--bex-amber)]/10 px-2 py-1 text-[10px] text-[color:var(--bex-amber)]"
            // A lista inteira no title: a coluna é estreita, e cortar a frase
            // no meio é pior do que não caber. O detalhe com o "como resolver"
            // fica na ficha.
            title={bloqueios.map((b) => b.titulo).join(" · ")}
          >
            <Lock className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {bloqueios.length === 1 ? bloqueios[0].titulo : `${bloqueios.length} pendências`}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex -space-x-1.5">
            {responsaveis.map((r: any) => (
              <Avatar key={r.id} className="h-5 w-5 border border-background" title={r.nome}>
                <AvatarImage src={r.avatar_url ?? undefined} />
                <AvatarFallback className="text-[9px]">{r.nome?.charAt(0)}</AvatarFallback>
              </Avatar>
            ))}
            {responsaveis.length === 0 && (
              <span
                className="flex items-center gap-1 text-[10px] text-muted-foreground"
                title="Sem designer nem operador definido"
              >
                <AlertTriangle className="h-3 w-3" />
                sem equipe
              </span>
            )}
          </div>
          {canSeeFinancials && Number(os.valor_total) > 0 && (
            <span className="font-mono text-xs text-[color:var(--bex-lime)]">
              {brl(Number(os.valor_total))}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

const PRIO_COR: Record<number, string> = {
  1: "bg-[color:var(--bex-magenta)]",
  2: "bg-amber-400",
  3: "bg-[color:var(--bex-cyan)]",
  4: "bg-muted-foreground/40",
  5: "bg-muted-foreground/30",
};
