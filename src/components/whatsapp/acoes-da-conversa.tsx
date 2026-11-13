import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Bot, CheckCheck, Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  MOTIVOS_DE_RESOLUCAO,
  SETORES,
  infoDoSetor,
  type MotivoResolucao,
  type Setor,
} from "@/domain/whatsapp/filas";
import type { PessoaDaEquipe } from "@/components/whatsapp/usar-caixa-de-entrada";
import { avisoParaFila, avisoParaPessoa } from "@/domain/whatsapp/aviso-de-transferencia";
import { setorDaPessoa } from "@/domain/whatsapp/equipe";
import { ATALHOS_DO_TECLADO } from "@/domain/whatsapp/teclado";
import { FECHAR_DE_44_PX } from "@/components/whatsapp/fechar-de-44-px";

/**
 * Diálogos e faixa da conversa aberta (caixa v3): Transferir (pessoa ou fila,
 * com motivo), Resolver (motivo obrigatório; "Atendido" travado quando o
 * cliente mandou a última mensagem) e a faixa que diz quem está no comando —
 * a assistente ou a equipe. Os atalhos de teclado também moram aqui.
 */

/* ------------------------------------------------------------------ */
/* Transferir                                                          */
/* ------------------------------------------------------------------ */

export function DialogoTransferir({
  aberto,
  onAberto,
  equipe,
  responsavelAtual,
  filaAtual,
  ocupado,
  assinatura,
  onPessoa,
  onFila,
}: {
  aberto: boolean;
  onAberto: (v: boolean) => void;
  equipe: PessoaDaEquipe[];
  responsavelAtual: string | null;
  filaAtual: string | null | undefined;
  ocupado: boolean;
  /** "*Cibele · Financeiro*": o que o despachante põe no topo do aviso. */
  assinatura: string | null;
  onPessoa: (para: string, aviso: string | null) => Promise<boolean>;
  onFila: (fila: Setor, motivo: string, aviso: string | null) => Promise<boolean>;
}) {
  const [destino, setDestino] = useState<"pessoa" | "fila">("pessoa");
  const [pessoa, setPessoa] = useState("");
  const [fila, setFila] = useState<Setor | "">("");
  const [motivo, setMotivo] = useState("");
  // Aviso ao cliente (14/10/2026): ligado por padrão, com a frase pronta e
  // editável. Trocar o destino refaz a frase — a não ser que a pessoa já a
  // tenha mudado à mão.
  const [avisar, setAvisar] = useState(true);
  const [aviso, setAviso] = useState("");
  const [avisoEditado, setAvisoEditado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setPessoa("");
    setFila("");
    setMotivo("");
    setAvisar(true);
    setAviso("");
    setAvisoEditado(false);
  }, [aberto]);

  const pessoas = equipe.filter((p) => p.id !== responsavelAtual);
  const escolhida = pessoas.find((p) => p.id === pessoa) ?? null;
  const fraseSugerida =
    destino === "pessoa"
      ? escolhida
        ? avisoParaPessoa(escolhida.nome, setorDaPessoa(escolhida.papeis))
        : ""
      : fila
        ? avisoParaFila(fila)
        : "";

  useEffect(() => {
    if (!avisoEditado) setAviso(fraseSugerida);
  }, [fraseSugerida, avisoEditado]);

  const textoDoAviso = avisar ? aviso.trim() : "";
  const pronto =
    (destino === "pessoa" ? !!pessoa : !!fila && motivo.trim().length >= 3) && (!avisar || textoDoAviso.length > 0);

  async function confirmar() {
    const enviar = textoDoAviso || null;
    const ok =
      destino === "pessoa"
        ? await onPessoa(pessoa, enviar)
        : await onFila(fila as Setor, motivo.trim(), enviar);
    if (ok) onAberto(false);
  }

  return (
    <Dialog open={aberto} onOpenChange={onAberto}>
      <DialogContent className={`sm:max-w-md ${FECHAR_DE_44_PX}`}>
        <DialogHeader>
          <DialogTitle>Transferir a conversa</DialogTitle>
          <DialogDescription>
            Para uma pessoa da equipe, ou para a fila de outro setor. Mudar de fila tira o responsável
            atual e quem é daquela fila assume.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm" role="tablist">
          {(["pessoa", "fila"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={destino === d}
              onClick={() => setDestino(d)}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded px-2 py-1.5",
                destino === d ? "bg-background font-semibold shadow-sm" : "text-muted-foreground",
              )}
            >
              {d === "pessoa" ? <UserRound className="h-4 w-4" /> : <ArrowRightLeft className="h-4 w-4" />}
              {d === "pessoa" ? "Para uma pessoa" : "Para outra fila"}
            </button>
          ))}
        </div>
        {destino === "pessoa" ? (
          <div className="space-y-1.5">
            <Label htmlFor="transferir-pessoa">Quem assume</Label>
            <Select value={pessoa} onValueChange={setPessoa}>
              <SelectTrigger id="transferir-pessoa">
                <SelectValue placeholder="Escolha a pessoa" />
              </SelectTrigger>
              <SelectContent>
                {pessoas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome ?? "Sem nome"}
                    {p.filas?.length ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        · {p.filas.map((f) => infoDoSetor(f).rotulo).join(", ")}
                      </span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Fila de destino</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {SETORES.map((s) => {
                  const atual = s.valor === filaAtual;
                  return (
                    <button
                      key={s.valor}
                      type="button"
                      disabled={atual}
                      aria-pressed={fila === s.valor}
                      onClick={() => setFila(s.valor)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-left text-sm transition-colors",
                        fila === s.valor ? cn(s.cor, "font-semibold") : "hover:bg-muted",
                        atual && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className={cn("h-2 w-2 rounded-full", s.ponto)} aria-hidden />
                      {s.rotulo}
                      {atual && <span className="ml-auto text-xs">atual</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transferir-motivo">Motivo</Label>
              <Textarea
                id="transferir-motivo"
                rows={2}
                maxLength={300}
                placeholder="Ex.: cliente quer saber do pagamento da OS 120"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">O motivo aparece na conversa para quem pegar.</p>
            </div>
          </div>
        )}
        {(destino === "pessoa" ? !!pessoa : !!fila) && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="transferir-avisar" className="text-sm font-medium">
                Avisar o cliente
              </Label>
              <Switch id="transferir-avisar" checked={avisar} onCheckedChange={setAvisar} />
            </div>
            {avisar ? (
              <>
                <Textarea
                  aria-label="Mensagem ao cliente"
                  rows={3}
                  maxLength={1000}
                  value={aviso}
                  onChange={(e) => {
                    setAviso(e.target.value);
                    setAvisoEditado(true);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Sai pelo WhatsApp em seu nome
                  {assinatura ? (
                    <>
                      , com <strong>{assinatura.replace(/^\*|\*$/g, "")}</strong> no topo
                    </>
                  ) : null}
                  . A conversa fica esperando quem recebe.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Só a equipe fica sabendo: o cliente não recebe nada.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" className="h-11" onClick={() => onAberto(false)}>
            Cancelar
          </Button>
          <Button className="h-11" onClick={() => void confirmar()} disabled={!pronto || ocupado}>
            {ocupado && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Resolver                                                            */
/* ------------------------------------------------------------------ */

export function DialogoResolver({
  aberto,
  onAberto,
  atendidoPermitido,
  numeroDoAtendimento,
  ocupado,
  onResolver,
}: {
  aberto: boolean;
  onAberto: (v: boolean) => void;
  /** Falso quando a última mensagem é do cliente (o banco recusaria). */
  atendidoPermitido: boolean;
  numeroDoAtendimento: string | null;
  ocupado: boolean;
  onResolver: (motivo: MotivoResolucao, nota?: string) => Promise<boolean>;
}) {
  const [motivo, setMotivo] = useState<MotivoResolucao | "">("");
  const [nota, setNota] = useState("");

  useEffect(() => {
    if (!aberto) return;
    setMotivo(atendidoPermitido ? "atendido" : "");
    setNota("");
  }, [aberto, atendidoPermitido]);

  const precisaNota = motivo === "outro";
  const pronto = !!motivo && (!precisaNota || nota.trim().length > 0);

  async function confirmar() {
    if (!motivo) return;
    const ok = await onResolver(motivo, nota.trim() || undefined);
    if (ok) onAberto(false);
  }

  return (
    <Dialog open={aberto} onOpenChange={onAberto}>
      <DialogContent className={`sm:max-w-md ${FECHAR_DE_44_PX}`}>
        <DialogHeader>
          <DialogTitle>Resolver{numeroDoAtendimento ? ` o atendimento ${numeroDoAtendimento}` : ""}</DialogTitle>
          <DialogDescription>
            O atendimento fecha e fica no histórico. Se o cliente escrever de novo, abre um novo.
          </DialogDescription>
        </DialogHeader>
        {!atendidoPermitido && (
          <p className="flex items-start gap-2 rounded-md border border-status-amber/40 bg-status-amber/10 p-2 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-amber" />
            O cliente mandou a última mensagem. Responda antes de marcar como “Atendido” ou escolha
            outro motivo.
          </p>
        )}
        <RadioGroup value={motivo} onValueChange={(v) => setMotivo(v as MotivoResolucao)} className="gap-1.5">
          {MOTIVOS_DE_RESOLUCAO.map((m) => {
            const travado = m.valor === "atendido" && !atendidoPermitido;
            return (
              <Label
                key={m.valor}
                htmlFor={`motivo-${m.valor}`}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border p-2 font-normal",
                  motivo === m.valor && "border-foreground/30 bg-muted",
                  travado && "cursor-not-allowed opacity-50",
                )}
              >
                <RadioGroupItem id={`motivo-${m.valor}`} value={m.valor} disabled={travado} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">{m.rotulo}</span>
                  <span className="block text-xs text-muted-foreground">{m.dica}</span>
                </span>
              </Label>
            );
          })}
        </RadioGroup>
        {precisaNota && (
          <div className="space-y-1.5">
            <Label htmlFor="resolver-nota">Nota (obrigatória)</Label>
            <Textarea
              id="resolver-nota"
              rows={2}
              maxLength={1000}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" className="h-11" onClick={() => onAberto(false)}>
            Cancelar
          </Button>
          <Button className="h-11" onClick={() => void confirmar()} disabled={!pronto || ocupado}>
            {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-1 h-4 w-4" />}
            Resolver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Quem está no comando                                                */
/* ------------------------------------------------------------------ */

/**
 * A faixa fina embaixo do cabeçalho. Só aparece quando a assistente está
 * LIGADA — com ela desligada, "modo auto" não quer dizer nada para quem atende.
 */
export function FaixaDoModo({
  iaLigada,
  modo,
  temResponsavel,
  aberta,
  podeDevolver,
  ocupado,
  onDevolver,
}: {
  iaLigada: boolean;
  modo: string | null | undefined;
  temResponsavel: boolean;
  aberta: boolean;
  podeDevolver: boolean;
  ocupado: boolean;
  onDevolver: () => void;
}) {
  if (!iaLigada || !aberta) return null;
  const comAssistente = modo === "auto" && !temResponsavel;
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b px-3 py-1.5 text-sm",
        comAssistente ? "bg-status-cyan/5 text-status-cyan" : "bg-muted/40 text-muted-foreground",
      )}
    >
      {comAssistente ? (
        <>
          <Bot className="h-3.5 w-3.5" />
          <span>
            <strong>Assistente ativa.</strong> Responde com os dados do sistema e chama a equipe quando
            precisa. Responder ou assumir passa para você.
          </span>
        </>
      ) : (
        <>
          <UserRound className="h-3.5 w-3.5" />
          <span>
            <strong>Atendimento humano.</strong> A assistente não responde nesta conversa.
          </span>
          {podeDevolver && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-11 px-3 text-sm"
              disabled={ocupado}
              onClick={onDevolver}
            >
              <Bot className="mr-1 h-4 w-4" /> Devolver à assistente
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Atalhos do teclado (a lista)                                        */
/* ------------------------------------------------------------------ */

/**
 * "Atalhos do teclado": a lista que abre pelo menu de três pontos da conversa
 * e da lista de conversas. Contrato da onda 1 (12/11/2026): dono CONVERSA; a
 * MOLDURA só abre (importa daqui). As teclas moram em domain/whatsapp/teclado.ts.
 */
export function DialogoAtalhos({
  aberto,
  onAberto,
}: {
  aberto: boolean;
  onAberto: (aberto: boolean) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={onAberto}>
      <DialogContent className={`sm:max-w-lg ${FECHAR_DE_44_PX}`}>
        <DialogHeader>
          <DialogTitle>Atalhos do teclado</DialogTitle>
          <DialogDescription className="text-base">
            Como no WhatsApp. Nenhuma letra sozinha faz ação: o que você digita vai para a conversa.
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-base">
          {ATALHOS_DO_TECLADO.map((a) => (
            <div key={a.teclas} className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-3">
              <dt className="font-semibold">{a.teclas}</dt>
              <dd className="text-muted-foreground">{a.faz}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Teclado                                                             */
/* ------------------------------------------------------------------ */

/**
 * `digitando` mora em domain/whatsapp/teclado.ts desde a onda 1 (12/11/2026).
 * Reexportada daqui só porque nova-conversa.tsx ainda a importa deste caminho
 * até a MOLDURA tirar a tecla N. As teclas soltas R, T e E (`useAtalhosDaConversa`)
 * saíram: a R assumia a conversa de outra pessoa sem perguntar.
 */
export { digitando } from "@/domain/whatsapp/teclado";
