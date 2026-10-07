import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Plus, Tag, User, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/bex/StatusChip";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { rotuloDe } from "@/domain/os/etapas";
import {
  ETIQUETAS_SUGERIDAS,
  adicionarEtiqueta,
  removerEtiqueta,
  telefoneLegivel,
  type ConversaDaCaixa,
} from "@/domain/whatsapp/caixa-de-entrada";
import {
  CHAVES,
  gravarEtiquetas,
  useHistoricoDoCliente,
  useMensagens,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { VincularCliente } from "@/components/whatsapp/vincular-cliente";
import { VinculosDaConversa } from "@/components/whatsapp/vinculos-da-conversa";
import { AtendimentosDaConversa } from "@/components/whatsapp/atendimentos-da-conversa";
import {
  CriarOrcamentoDaConversa,
  CriarOsDaConversa,
} from "@/components/whatsapp/criar-a-partir-da-conversa";

const ROTULO_ORCAMENTO: Record<string, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  expirado: "Expirado",
  convertido: "Convertido em OS",
};

const ROTULO_LEAD: Record<string, string> = {
  novo: "novo",
  em_atendimento: "em atendimento",
  orcamento: "em orçamento",
  ganho: "ganho",
  perdido: "perdido",
};

/**
 * A coluna da direita: com quem é a conversa, o que fazer com ela e o que esse
 * cliente já tem na casa. Substitui o "Histórico" fixo da tela antiga
 * (OS-1042, OS-1031, Orç #245 — números que não existiam).
 */
export function PainelDaConversa({
  conversa,
  className,
}: {
  conversa: ConversaDaCaixa;
  className?: string;
}) {
  const { hasPermission, nivelDeVisao } = useAuth();
  const podeResponder = hasPermission("whatsapp.reply");
  const podeOrcar = hasPermission("orcamentos.create");
  const podeAbrirOs = hasPermission("os.create");
  const mensagens = useMensagens(conversa.id);
  const historico = useHistoricoDoCliente(conversa.cliente_id, nivelDeVisao);

  return (
    <Card className={cn("flex flex-col overflow-auto", className)}>
      <section className="space-y-2 border-b p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Contato</div>
        <div className="flex items-center gap-2 font-medium">
          <User className="h-4 w-4 shrink-0" />
          <span className="truncate">{conversa.nome_contato || "Sem nome no WhatsApp"}</span>
        </div>
        <div className="text-xs text-muted-foreground">{telefoneLegivel(conversa.telefone)}</div>
        {conversa.cliente ? (
          <p className="text-sm">
            Cliente:{" "}
            <Link
              to="/clientes/$id"
              params={{ id: conversa.cliente.id }}
              className="font-medium text-primary underline underline-offset-2"
            >
              {conversa.cliente.nome}
            </Link>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Sem cliente vinculado.</p>
        )}
        {conversa.lead && !conversa.cliente && (
          <p className="text-xs text-muted-foreground">
            Lead aberto pelo WhatsApp: {conversa.lead.nome ?? "sem nome"} (
            {ROTULO_LEAD[conversa.lead.status ?? ""] ?? conversa.lead.status ?? "—"}).{" "}
            {hasPermission("leads.read") && (
              <Link to="/leads" className="text-primary underline underline-offset-2">
                Abrir Leads
              </Link>
            )}
          </p>
        )}
        {podeResponder && <VincularCliente conversa={conversa} />}
      </section>

      <AtendimentosDaConversa conversaId={conversa.id} />

      <section className="space-y-2 border-b p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Transformar em trabalho
        </div>
        {podeOrcar ? (
          <CriarOrcamentoDaConversa conversa={conversa} mensagens={mensagens.data ?? []} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Criar orçamento exige a permissão orçamentos › create.
          </p>
        )}
        {podeAbrirOs && conversa.cliente_id ? (
          <CriarOsDaConversa
            conversa={{ ...conversa, cliente_id: conversa.cliente_id }}
            mensagens={mensagens.data ?? []}
          />
        ) : (
          // O caminho que existe para quem não abre OS direto: o orçamento,
          // que o gerente converte. Dito no lugar do botão, não escondido.
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            {!podeAbrirOs
              ? "Abrir OS direto é do administrador. Crie o orçamento: aprovado, ele vira OS pelo gerente."
              : "A OS exige cliente cadastrado. Vincule a conversa a um cliente — ou comece pelo orçamento."}
          </p>
        )}
        {conversa.os_id && (
          <p className="text-xs">
            <Link
              to="/os/$id"
              params={{ id: conversa.os_id }}
              className="font-medium text-primary underline underline-offset-2"
            >
              Abrir a OS ligada a esta conversa
            </Link>
          </p>
        )}
      </section>

      <VinculosDaConversa conversa={conversa} podeEditar={podeResponder} />

      <Etiquetas conversa={conversa} podeEditar={podeResponder} />

      <section className="space-y-3 p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Histórico do cliente
        </div>
        {!conversa.cliente_id ? (
          <p className="text-xs text-muted-foreground">
            Vincule a conversa a um cliente para ver os orçamentos e as OS dele aqui.
          </p>
        ) : historico.isError ? (
          <p className="text-xs text-destructive">
            Não foi possível carregar o histórico: {mensagemErro(historico.error)}
          </p>
        ) : historico.isPending ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-muted-foreground">
                Orçamentos recentes
              </div>
              {historico.data.orcamentos.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum orçamento deste cliente.</p>
              ) : (
                historico.data.orcamentos.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-2">
                    <Link
                      to="/orcamentos/$id"
                      params={{ id: o.id }}
                      className="truncate text-primary underline-offset-2 hover:underline"
                    >
                      #{o.numero} · {o.titulo}
                    </Link>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {ROTULO_ORCAMENTO[o.status] ?? o.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-muted-foreground">OS recentes</div>
              {historico.data.os.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma OS deste cliente.</p>
              ) : (
                historico.data.os.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-2">
                    <Link
                      to="/os/$id"
                      params={{ id: o.id }}
                      className="truncate text-primary underline-offset-2 hover:underline"
                    >
                      OS #{o.numero} · {o.titulo}
                    </Link>
                    <StatusChip label={rotuloDe(o.status)} tone="cyan" className="shrink-0" />
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </section>
    </Card>
  );
}

/**
 * Etiquetas gravadas em `whatsapp_conversas.etiquetas` (text[], já existia).
 * A tela antiga trocava a etiqueta só no estado da página — some no F5.
 */
function Etiquetas({ conversa, podeEditar }: { conversa: ConversaDaCaixa; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [nova, setNova] = useState("");
  const [gravando, setGravando] = useState(false);
  const atuais = conversa.etiquetas ?? [];
  const sugestoes = ETIQUETAS_SUGERIDAS.filter(
    (s) => adicionarEtiqueta(atuais, s).length > atuais.length,
  );

  async function salvar(lista: string[], aviso: string) {
    setGravando(true);
    try {
      await gravarEtiquetas(conversa.id, lista);
      toast.success(aviso);
      setNova("");
      void qc.invalidateQueries({ queryKey: CHAVES.conversas });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <section className="space-y-2 border-b p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Tag className="h-3.5 w-3.5" /> Etiquetas
      </div>
      <div className="flex flex-wrap gap-1">
        {atuais.length === 0 && (
          <span className="text-xs text-muted-foreground">Nenhuma etiqueta.</span>
        )}
        {atuais.map((e) => (
          <Badge key={e} variant="outline" className="gap-1 text-[11px]">
            {e}
            {podeEditar && (
              <button
                type="button"
                aria-label={`Tirar a etiqueta ${e}`}
                disabled={gravando}
                onClick={() => void salvar(removerEtiqueta(atuais, e), `Etiqueta "${e}" retirada`)}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      {podeEditar && (
        <>
          <div className="flex flex-wrap gap-1">
            {sugestoes.map((s) => (
              <Button
                key={s}
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                disabled={gravando}
                onClick={() => void salvar(adicionarEtiqueta(atuais, s), `Etiqueta "${s}" gravada`)}
              >
                <Plus className="mr-0.5 h-3 w-3" /> {s}
              </Button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              const lista = adicionarEtiqueta(atuais, nova);
              if (lista.length === atuais.length) return;
              void salvar(lista, "Etiqueta gravada");
            }}
          >
            <Input
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              placeholder="Outra etiqueta"
              className="h-8 text-xs"
              maxLength={30}
              aria-label="Nova etiqueta"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={gravando || !nova.trim()}
            >
              Etiquetar
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
