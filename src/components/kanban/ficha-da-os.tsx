import { Link } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/bex/StatusChip";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ETAPAS_QUADRO,
  ROTULO_ETAPA,
  etapaDe,
  fluxo,
  rotuloDe,
  setorDe,
} from "@/domain/os/etapas";
import { areaEmTexto, descreverItem, resumoDaProducao } from "@/domain/os/o-que-produzir";
import { formatarData, paradaHa, prazoEmPalavras } from "@/domain/os/prazo";
import type { BloqueioOs } from "@/components/kanban/cartao-os";
import { Check, Circle, ExternalLink, Lock, Pause } from "lucide-react";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * A ficha da OS — o que o cartão abre.
 *
 * Antes o cartão não abria nada: o corpo era alça de arrasto, e o único link
 * era o número da OS, em fonte 10. Quem quisesse ver o que a OS manda produzir
 * saía do quadro.
 *
 * A ficha é deliberadamente um painel lateral e não uma página: o operador que
 * está lendo o quadro quer conferir uma OS e voltar, não navegar. A página
 * completa continua existindo, com um link no rodapé.
 */
export function FichaDaOs({
  os,
  bloqueios = [],
  canSeeFinancials,
  aberto,
  onFechar,
  onMudarStatus,
}: {
  os: any | null;
  bloqueios?: BloqueioOs[];
  canSeeFinancials?: boolean;
  aberto: boolean;
  onFechar: () => void;
  onMudarStatus: (osId: string, novoStatus: string) => void;
}) {
  if (!os) return null;

  const etapaAtual = etapaDe(os.status);
  const prazo = prazoEmPalavras(os.prazo_entrega);
  const producao = resumoDaProducao(os.itens);
  const parada = paradaHa(os.updated_at);
  const foraDoFluxo = etapaAtual === "fora_do_fluxo";

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="space-y-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              OS #{os.numero}
            </span>
            {prazo && (
              <StatusChip
                label={prazo.texto}
                tone={prazo.tom === "magenta" ? "magenta" : prazo.tom === "amber" ? "amber" : "muted"}
              />
            )}
          </div>
          <SheetTitle className="text-lg leading-tight">{os.titulo}</SheetTitle>
          <SheetDescription>
            {os.cliente_nome ?? "Sem cliente vinculado"}
            {canSeeFinancials && Number(os.valor_total) > 0 && (
              <span className="ml-2 font-mono text-[color:var(--bex-lime)]">
                {brl(Number(os.valor_total))}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-6">
          <Bloco titulo="Etapas">
            {foraDoFluxo ? (
              <div className="flex items-center gap-2 rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Pause className="h-3.5 w-3.5" />
                {/* Pausada não está no começo do caminho, está FORA dele. Uma
                    barra vazia diria a coisa errada. */}
                <span>
                  {rotuloDe(os.status)} — fora do fluxo. Não conta como fila até voltar a andar.
                </span>
              </div>
            ) : (
              <ol className="space-y-0">
                {ETAPAS_QUADRO.map((etapa, i) => {
                  const posicaoAtual = etapaAtual ? ETAPAS_QUADRO.indexOf(etapaAtual as any) : -1;
                  const estado = i < posicaoAtual ? "feita" : i === posicaoAtual ? "atual" : "futura";
                  const ultima = i === ETAPAS_QUADRO.length - 1;
                  return (
                    <li key={etapa} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            estado === "feita"
                              ? "border-[color:var(--bex-lime)]/50 bg-[color:var(--bex-lime)]/15 text-[color:var(--bex-lime)]"
                              : estado === "atual"
                                ? "border-[color:var(--bex-cyan)] bg-[color:var(--bex-cyan)]/15 text-[color:var(--bex-cyan)]"
                                : "border-border text-muted-foreground/50"
                          }`}
                        >
                          {estado === "feita" ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Circle className="h-2 w-2 fill-current" />
                          )}
                        </span>
                        {!ultima && (
                          <span
                            className={`w-px flex-1 ${
                              estado === "feita" ? "bg-[color:var(--bex-lime)]/40" : "bg-border"
                            }`}
                          />
                        )}
                      </div>
                      <div className={`pb-3 ${estado === "futura" ? "opacity-55" : ""}`}>
                        <div className="text-xs font-semibold text-foreground">
                          {ROTULO_ETAPA[etapa]}
                          {estado === "atual" && (
                            <span className="ml-2 font-normal text-[color:var(--bex-cyan)]">
                              {/* Repetir "Entrada — Entrada" não informa nada. O
                                  status só aparece quando diz algo além do nome
                                  da etapa. */}
                              {rotuloDe(os.status) !== ROTULO_ETAPA[etapa] && rotuloDe(os.status)}
                              {parada &&
                                `${rotuloDe(os.status) !== ROTULO_ETAPA[etapa] ? " · " : ""}parada há ${parada}`}
                            </span>
                          )}
                        </div>
                        {estado === "atual" && (
                          <div className="text-[11px] text-muted-foreground">
                            Setor: {setorDe(os.status)}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Bloco>

          <Bloco titulo="Mudar status">
            <Select value={os.status} onValueChange={(v) => onMudarStatus(os.id, v)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fluxo().map((et) => (
                  <SelectGroup key={et.etapa}>
                    <SelectLabel className="text-[10px] uppercase tracking-wider">
                      {et.rotulo}
                    </SelectLabel>
                    {et.status.map((s) => (
                      <SelectItem key={s.status} value={s.status}>
                        {s.rotulo}
                        {s.observacao && <span className="ml-1 text-[color:var(--bex-amber)]">!</span>}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Arrastar o cartão troca a etapa; aqui você escolhe o passo exato dentro dela.
            </p>
          </Bloco>

          {bloqueios.length > 0 && (
            <Bloco titulo={`O que falta para produzir (${bloqueios.length})`}>
              <ul className="space-y-2">
                {bloqueios.map((b) => (
                  <li
                    key={b.codigo}
                    className="rounded border border-[color:var(--bex-amber)]/30 bg-[color:var(--bex-amber)]/10 px-3 py-2"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--bex-amber)]">
                      <Lock className="h-3 w-3" />
                      {b.titulo}
                    </div>
                    <div className="mt-0.5 pl-[18px] text-[11px] text-muted-foreground">
                      {b.resolver}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Estas são as mesmas regras que o banco aplica ao avançar a OS — vêm da função
                <code className="mx-1 font-mono">os_bloqueios_para</code>, não de uma cópia na tela.
              </p>
            </Bloco>
          )}

          <Bloco titulo="O que vai ser produzido">
            {producao ? (
              <>
                <ul className="space-y-1.5">
                  {(os.itens as any[]).map((item, i) => (
                    <li
                      key={item.id ?? i}
                      className="flex items-start justify-between gap-2 rounded border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="text-foreground/85">{descreverItem(item)}</span>
                      {canSeeFinancials && Number(item.valor_total) > 0 && (
                        <span className="shrink-0 font-mono text-muted-foreground">
                          {brl(Number(item.valor_total))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {areaEmTexto(producao.areaTotal) && (
                  <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                    Metragem total: {areaEmTexto(producao.areaTotal)}
                  </div>
                )}
              </>
            ) : (
              <Vazio texto="Nenhum item cadastrado nesta OS. Sem item, a produção não sabe o que fazer nem o estoque o que baixar." />
            )}
          </Bloco>

          <Bloco titulo="Combinado e equipe">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
              <Linha rotulo="Prazo de entrega" valor={formatarData(os.prazo_entrega)} />
              <Linha rotulo="Prioridade" valor={PRIORIDADE[os.prioridade] ?? "—"} />
              <Linha rotulo="Responsável" valor={os.responsavel?.nome ?? "não definido"} />
              <Linha rotulo="Designer" valor={os.designer?.nome ?? "não definido"} />
              <Linha rotulo="Operador" valor={os.operador?.nome ?? "não definido"} />
              <Linha rotulo="Anexos" valor={`${os.arquivos?.length ?? 0} arquivo(s)`} />
            </dl>
            {os.briefing && (
              <div className="mt-3 rounded border border-border/60 bg-muted/30 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
                {os.briefing}
              </div>
            )}
          </Bloco>

          <Link
            to="/os/$id"
            params={{ id: os.id }}
            className="block"
            onClick={onFechar}
          >
            <Button variant="outline" size="sm" className="w-full">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Abrir a OS completa
            </Button>
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const PRIORIDADE: Record<number, string> = {
  1: "Urgente",
  2: "Alta",
  3: "Normal",
  4: "Baixa",
  5: "Mínima",
};

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="truncate font-medium text-foreground/85">{valor}</dd>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <p className="rounded border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
      {texto}
    </p>
  );
}
