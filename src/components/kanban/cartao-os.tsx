import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ROTULO_DA_FINALIDADE, type FinalidadeDaOS } from "@/domain/os/finalidade";
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
 * de movimento (mouse) ou de 250 ms segurando (toque), e clique parado nunca
 * vira arrasto.
 */

export type BloqueioOs = { codigo: string; titulo: string; resolver: string };

// O cartão escrevia "R$ 340.00" — ponto decimal, formato de planilha em inglês.
// O resto do sistema já usa o mesmo `brl`.
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
          {/* text-xs no celular, 10px no desktop: o cartão é lido a um braço
              de distância na oficina; abaixo de 12px não se lê. */}
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground md:text-[10px]">
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

        {os.finalidade && os.finalidade !== "venda" ? (
          // OS interna: o "cliente" é a casa — o que importa é para que é.
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline">{ROTULO_DA_FINALIDADE[os.finalidade as FinalidadeDaOS] ?? os.finalidade}</Badge>
            {os.local_mostruario && <span className="truncate">{os.local_mostruario}</span>}
          </div>
        ) : os.cliente_nome && (
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
            <div className="flex items-start gap-1.5 text-xs leading-snug text-foreground/85 md:text-[11px]">
              <Layers className="mt-px h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="line-clamp-2">{producao.linha}</span>
            </div>
            <div className="mt-0.5 flex gap-2 pl-[18px] font-mono text-xs text-muted-foreground md:text-[10px]">
              {producao.extras > 0 && <span>+{producao.extras} item(ns)</span>}
              {areaEmTexto(producao.areaTotal) && <span>{areaEmTexto(producao.areaTotal)}</span>}
            </div>
          </div>
        )}

        {/* O status exato dentro da etapa: a coluna diz o estágio, o cartão diz
            o passo. É o que substituiu vinte e cinco colunas. E o selo da
            máquina diz o caminho, sem custar coluna nenhuma. */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs md:text-[10px]">
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
            <span className="font-mono text-muted-foreground">parada há {parada}</span>
          )}
        </div>

        {/* O que impede de avançar — antes do arrasto, não depois do erro. */}
        {bloqueios.length > 0 && (
          <div className="flex items-center gap-1.5 rounded border border-[color:var(--bex-amber)]/30 bg-[color:var(--bex-amber)]/10 px-2 py-1 text-xs text-[color:var(--bex-amber)] md:text-[10px]">
            {/* A primeira pendência pelo nome, e quantas mais: "2 pendências"
                escondia as duas no title, que não abre no celular nem na TV.
                O "como resolver" de cada uma fica na ficha (o cartão abre). */}
            <Lock className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{bloqueios[0].titulo}</span>
            {bloqueios.length > 1 && <span className="shrink-0 font-semibold">+{bloqueios.length - 1}</span>}
            <span className="sr-only">{bloqueios.map((b) => b.titulo).join(", ")}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          {/* Quem está na OS pelo nome: o rosto sozinho só dizia quem era no
              title, que não abre no toque. */}
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
            {responsaveis.length > 0 && (
              <span className="truncate text-xs text-muted-foreground md:text-[10px]">
                {responsaveis.map((r: any) => primeiroNome(r.nome)).join(" · ")}
              </span>
            )}
            {responsaveis.length === 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground md:text-[10px]">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                sem designer nem operador
              </span>
            )}
          </div>
          {canSeePrices && Number(os.valor_total) > 0 && (
            <span className="font-mono text-xs text-[color:var(--bex-lime)]">
              {brl(Number(os.valor_total))}
            </span>
          )}
        </div>

        {/* Quem mexeu por último e quando — todos movem, e o registro fica à vista. */}
        {os.ultimo_movimento?.rotulo && (
          // De onde veio fica à vista: "Produção → Arte" é retrabalho, e só o
          // title dizia isso.
          <div className="line-clamp-2 border-t border-border/60 pt-1.5 font-mono text-xs text-muted-foreground md:text-[10px]">
            {os.ultimo_movimento.verbo ?? "movida"} por {os.ultimo_movimento.rotulo}
            {os.ultimo_movimento.passo && <> · {os.ultimo_movimento.passo}</>}
          </div>
        )}
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
