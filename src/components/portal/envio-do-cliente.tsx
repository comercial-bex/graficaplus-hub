import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, ExternalLink, FileUp, Loader2, MessageSquare, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/bex/StatusChip";
import { mensagemErro } from "@/lib/erros";
import {
  TAMANHO_MAXIMO_MB,
  TIPOS_DE_ENVIO,
  TIPOS_DE_MENSAGEM,
  problemaNaMensagem,
  problemaNoEnvio,
  type TipoDeEnvio,
  type TipoDeMensagem,
} from "@/domain/portal/envio-de-arquivo";
import {
  formatarDia,
  formatarReal,
  rotuloDaSolicitacao,
  rotuloDoAndamento,
  rotuloDoComprovante,
  separarOrdens,
  type ComprovanteNoPortal,
  type OrcamentoNoPortal,
  type OrdemNoPortal,
  type PainelDoCliente,
  type SolicitacaoNoPortal,
} from "@/domain/portal/painel-do-cliente";

/** O que a gravação devolveu. Só existe depois que o banco gravou. */
export type Recibo = { protocolo: string; os_numero: number | null };

const SEM_OS = "sem-os";

function opcoesDePedido(ordens: OrdemNoPortal[]) {
  // Pedido cancelado não recebe arquivo (o banco recusa); entregue ainda pode
  // receber comprovante e arquivo de última hora.
  return ordens.filter((o) => o.status !== "cancelado");
}

/* ------------------------------------------------------------------------- */
/* Arquivo e comprovante                                                      */
/* ------------------------------------------------------------------------- */

export function EnvioDeArquivo({
  ordens,
  onEnviar,
}: {
  ordens: OrdemNoPortal[];
  /** Resolve com o protocolo SÓ depois de gravado; erro sobe com o motivo. */
  onEnviar: (dados: {
    tipo: TipoDeEnvio;
    osId: string | null;
    arquivo: File;
    mensagem: string;
  }) => Promise<Recibo>;
}) {
  const pedidos = opcoesDePedido(ordens);
  const { abertas } = separarOrdens(pedidos);
  const [tipo, setTipo] = useState<TipoDeEnvio>("arte");
  const [osId, setOsId] = useState<string>(abertas[0]?.id ?? pedidos[0]?.id ?? SEM_OS);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recibo, setRecibo] = useState<(Recibo & { tipo: TipoDeEnvio; nome: string }) | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const osEscolhida = osId === SEM_OS ? null : osId;
  const ajuda = TIPOS_DE_ENVIO.find((t) => t.valor === tipo)?.ajuda;

  async function enviar() {
    const problema = problemaNoEnvio({ tipo, osId: osEscolhida, arquivo, mensagem });
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      const r = await onEnviar({ tipo, osId: osEscolhida, arquivo: arquivo!, mensagem });
      setRecibo({ ...r, tipo, nome: arquivo!.name });
      setArquivo(null);
      setMensagem("");
      if (entrada.current) entrada.current.value = "";
    } catch (e) {
      setErro(mensagemErro(e, "O envio não foi concluído. Tente de novo."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      {recibo && (
        <div className="flex gap-2 rounded-md border border-[color:var(--bex-lime,green)]/40 bg-[color:var(--bex-lime,green)]/10 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">
              {recibo.tipo === "comprovante" ? "Comprovante recebido" : "Arquivo recebido"} —
              protocolo <span className="font-mono">{recibo.protocolo}</span>
            </div>
            <div className="text-muted-foreground">
              {recibo.tipo === "comprovante"
                ? "Ficou com o financeiro, que vai conferir o pagamento."
                : `"${recibo.nome}" já está no pedido ${recibo.os_numero ?? ""} para a equipe.`}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="portal-tipo-envio">O que você vai mandar?</Label>
          <Select
            value={tipo}
            onValueChange={(v) => {
              setTipo(v as TipoDeEnvio);
              // "Não sei / outro pagamento" só existe para comprovante: arquivo
              // sem pedido não teria onde aparecer para a equipe.
              if (v !== "comprovante" && osId === SEM_OS) setOsId(pedidos[0]?.id ?? SEM_OS);
            }}
          >
            <SelectTrigger id="portal-tipo-envio" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_DE_ENVIO.map((t) => (
                <SelectItem key={t.valor} value={t.valor}>
                  {t.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="portal-pedido-envio">De qual pedido?</Label>
          <Select value={osId} onValueChange={setOsId}>
            <SelectTrigger id="portal-pedido-envio" className="h-11">
              <SelectValue placeholder="Escolha o pedido" />
            </SelectTrigger>
            <SelectContent>
              {pedidos.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  Pedido nº {o.numero} — {o.titulo || "sem título"}
                </SelectItem>
              ))}
              {tipo === "comprovante" && (
                <SelectItem value={SEM_OS}>Não sei / outro pagamento</SelectItem>
              )}
            </SelectContent>
          </Select>
          {pedidos.length === 0 && tipo !== "comprovante" && (
            <p className="text-xs text-muted-foreground">
              Você ainda não tem pedido aberto. Fale com a equipe para abrir a ordem de serviço.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="portal-arquivo">Arquivo (até {TAMANHO_MAXIMO_MB} MB)</Label>
        <Input
          id="portal-arquivo"
          ref={entrada}
          type="file"
          className="h-11"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="portal-recado">Recado para a equipe (opcional)</Label>
        <Textarea
          id="portal-recado"
          rows={2}
          value={mensagem}
          onChange={(e) => setMensagem(e.target.value)}
          placeholder={
            tipo === "comprovante"
              ? "Ex.: pagamento da entrada por Pix."
              : "Ex.: usar este logo no topo do banner."
          }
        />
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      <Button className="h-11 w-full sm:w-auto" onClick={() => void enviar()} disabled={enviando}>
        {enviando ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileUp className="mr-2 h-4 w-4" />
        )}
        {enviando ? "Enviando…" : "Enviar"}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Recado                                                                     */
/* ------------------------------------------------------------------------- */

export function MensagemParaEquipe({
  ordens,
  onEnviar,
}: {
  ordens: OrdemNoPortal[];
  onEnviar: (dados: {
    tipo: TipoDeMensagem;
    osId: string | null;
    mensagem: string;
  }) => Promise<Recibo>;
}) {
  const [tipo, setTipo] = useState<TipoDeMensagem>("duvida");
  const [osId, setOsId] = useState<string>(SEM_OS);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recibo, setRecibo] = useState<Recibo | null>(null);

  async function enviar() {
    const problema = problemaNaMensagem(texto);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      setRecibo(await onEnviar({ tipo, osId: osId === SEM_OS ? null : osId, mensagem: texto }));
      setTexto("");
    } catch (e) {
      setErro(mensagemErro(e, "A mensagem não foi enviada. Tente de novo."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      {recibo && (
        <div className="flex gap-2 rounded-md border p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Mensagem registrada — protocolo <span className="font-mono">{recibo.protocolo}</span>. A
            equipe responde pelo WhatsApp ou por aqui.
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="portal-assunto">Assunto</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoDeMensagem)}>
            <SelectTrigger id="portal-assunto" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_DE_MENSAGEM.map((t) => (
                <SelectItem key={t.valor} value={t.valor}>
                  {t.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="portal-pedido-msg">Sobre qual pedido?</Label>
          <Select value={osId} onValueChange={setOsId}>
            <SelectTrigger id="portal-pedido-msg" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_OS}>Geral / nenhum</SelectItem>
              {ordens.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  Pedido nº {o.numero} — {o.titulo || "sem título"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="portal-mensagem">Mensagem</Label>
        <Textarea
          id="portal-mensagem"
          rows={3}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escreva aqui para a equipe da Bex Print."
        />
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <Button className="h-11 w-full sm:w-auto" onClick={() => void enviar()} disabled={enviando}>
        {enviando ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <MessageSquare className="mr-2 h-4 w-4" />
        )}
        {enviando ? "Enviando…" : "Enviar mensagem"}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* O que já foi mandado                                                       */
/* ------------------------------------------------------------------------- */

export function OQueVoceMandou({
  solicitacoes,
  comprovantes,
}: {
  solicitacoes: SolicitacaoNoPortal[];
  comprovantes: ComprovanteNoPortal[];
}) {
  if (solicitacoes.length === 0 && comprovantes.length === 0) {
    return <p className="text-sm text-muted-foreground">Nada enviado por aqui ainda.</p>;
  }
  return (
    <div className="space-y-4">
      {comprovantes.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Comprovantes
          </div>
          {comprovantes.map((c) => {
            const r = rotuloDoComprovante(c.situacao);
            return (
              <div key={c.id} className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate">
                    {c.nome}
                    {c.os_numero ? ` · pedido ${c.os_numero}` : ""} · {formatarDia(c.criado_em)}
                  </span>
                  <StatusChip label={r.texto} tone={r.tom} />
                </div>
                {c.motivo && <p className="text-muted-foreground">Motivo: {c.motivo}</p>}
              </div>
            );
          })}
        </div>
      )}
      {solicitacoes.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Mensagens e arquivos
          </div>
          {solicitacoes.map((s) => {
            const r = rotuloDoAndamento(s.status);
            return (
              <div key={s.id} className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {rotuloDaSolicitacao(s.tipo)}
                    {s.os_numero ? ` · pedido ${s.os_numero}` : ""} · {formatarDia(s.criado_em)}
                  </span>
                  <StatusChip label={r.texto} tone={r.tom} />
                </div>
                <p className="whitespace-pre-wrap">{s.mensagem}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Orçamentos e contato                                                       */
/* ------------------------------------------------------------------------- */

export function OrcamentosParaResponder({ orcamentos }: { orcamentos: OrcamentoNoPortal[] }) {
  if (orcamentos.length === 0) return null;
  return (
    <div className="space-y-2">
      {orcamentos.map((o) => (
        <div
          key={o.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
        >
          <div className="min-w-0">
            <div className="font-mono text-xs text-muted-foreground">Orçamento nº {o.numero}</div>
            <div className="font-medium">{o.titulo || "Orçamento"}</div>
            <div className="text-sm text-muted-foreground">
              {formatarReal(o.valor_total)} ·{" "}
              {o.status === "aprovado" ? "aprovado — vai virar pedido" : "esperando a sua resposta"}
            </div>
          </div>
          {o.token_publico ? (
            <Button
              asChild
              variant={o.status === "enviado" ? "default" : "outline"}
              className="h-11"
            >
              <Link to="/orcamento-publico/$token" params={{ token: o.token_publico }}>
                <ExternalLink className="mr-1 h-4 w-4" />
                {o.status === "enviado" ? "Ver e responder" : "Ver orçamento"}
              </Link>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Peça à equipe o link para responder online.
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function ContatoDaEmpresa({ empresa }: { empresa: PainelDoCliente["empresa"] }) {
  if (!empresa.telefones && !empresa.email) return null;
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <Phone className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Prefere falar com alguém? {empresa.nome}
        {empresa.telefones ? ` · ${empresa.telefones}` : ""}
        {empresa.email ? ` · ${empresa.email}` : ""}
      </span>
    </div>
  );
}
