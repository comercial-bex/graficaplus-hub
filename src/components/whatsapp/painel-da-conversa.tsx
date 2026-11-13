import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, FileText, Link2, Lock, Plus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/bex/StatusChip";
import { AjudaDaSecao } from "@/components/whatsapp/ajuda-da-secao";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { DICAS_WA_GAVETA } from "@/lib/dicas";
import { cn } from "@/lib/utils";
import { rotuloDe } from "@/domain/os/etapas";
import {
  ETIQUETAS_SUGERIDAS,
  adicionarEtiqueta,
  removerEtiqueta,
  nomeDaConversa,
  telefoneLegivel,
  type ConversaDaCaixa,
} from "@/domain/whatsapp/caixa-de-entrada";
import {
  oQueDaPraFazer,
  type DialogoDaConversa,
  type Disponivel,
} from "@/domain/whatsapp/acoes-de-trabalho";
import {
  CHAVES,
  gravarEtiquetas,
  useFotosDosContatos,
  useHistoricoDoCliente,
  useMensagens,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { FotoDoContato } from "@/components/whatsapp/foto-do-contato";
import { DialogosDaConversa } from "@/components/whatsapp/dialogos-da-conversa";
import { VinculosDaConversa } from "@/components/whatsapp/vinculos-da-conversa";
import { AtendimentosDaConversa } from "@/components/whatsapp/atendimentos-da-conversa";
import { Carregando } from "@/components/bex/Carregando";
import { EtiquetaDeTipoDoContato } from "@/components/whatsapp/etiqueta-de-tipo-do-contato";
import { useOrigemDaConversa } from "@/components/whatsapp/usar-origem-da-conversa";

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

/** Título de seção: 15 px, primeira letra maiúscula, sem caixa-alta espaçada (onda 1, 12/11/2026). */
const TITULO_DA_SECAO = "flex items-center gap-2 text-sm font-semibold text-foreground";

/** Link de 44 px de altura: o dedo acerta na gaveta. */
const LINK_DE_44 = "inline-flex min-h-11 items-center font-medium text-link underline underline-offset-2";

/**
 * O miolo da gaveta "Dados do contato": com quem é a conversa, o que fazer com
 * ela e o que esse cliente já tem na casa. Substituiu o "Histórico" fixo da tela
 * antiga (OS-1042, OS-1031, Orç #245: números que não existiam).
 *
 * Cinco seções na ordem do uso (a1 8.6, 12/11/2026):
 *   1. Contato            foto, nome, telefone, cliente ou "Vincular", lead
 *   2. Trabalho           criar orçamento, criar OS, orçamentos e OS ligados
 *   3. Atendimentos       o atual e, recolhidos, os anteriores
 *   4. Etiquetas
 *   5. Histórico do cliente (recolhido)
 *
 * Os botões abrem diálogos controlados que a moldura desenha uma vez
 * (`DialogosDaConversa`); quem monta o painel sem a moldura (`onAbrirDialogo`
 * ausente) leva os diálogos junto, com estado próprio.
 */
export function PainelDaConversa({
  conversa,
  onAbrirDialogo,
  className,
}: {
  conversa: ConversaDaCaixa;
  onAbrirDialogo?: (d: DialogoDaConversa) => void;
  className?: string;
}) {
  const { hasPermission, nivelDeVisao } = useAuth();
  const podeResponder = hasPermission("whatsapp.reply");
  const pode = oQueDaPraFazer({
    podeResponder,
    podeOrcar: hasPermission("orcamentos.create"),
    podeAbrirOs: hasPermission("os.create"),
    clienteId: conversa.cliente_id,
  });
  const mensagens = useMensagens(conversa.id);
  // Conversa que a gráfica começou (aviso automático): o cliente ainda não
  // escreveu, e é isso que o painel de atendimentos tem de dizer.
  const semMensagemDoCliente =
    !!mensagens.data && !mensagens.data.some((m) => m.direcao === "entrada");
  const historico = useHistoricoDoCliente(conversa.cliente_id, nivelDeVisao);
  const origem = useOrigemDaConversa(conversa);
  const fotos = useFotosDosContatos([conversa.foto_path]);
  const nome = nomeDaConversa(conversa);
  const [dialogoLocal, setDialogoLocal] = useState<DialogoDaConversa | null>(null);
  const abrir = onAbrirDialogo ?? setDialogoLocal;

  return (
    <Card className={cn("flex flex-col overflow-auto", className)}>
      <section className="space-y-3 border-b p-4" aria-labelledby="gaveta-contato">
        <h3 id="gaveta-contato" className="sr-only">
          Contato
        </h3>
        <div className="flex items-center gap-3">
          <FotoDoContato
            nome={nome}
            url={conversa.foto_path ? fotos.data?.get(conversa.foto_path) : null}
            className="size-16 shrink-0"
            classeDasIniciais="text-lg"
          />
          <div className="min-w-0">
            {/* Primeiro quem é (o cliente do cadastro); o nome do WhatsApp é detalhe. */}
            <p className="break-words text-base font-semibold">{nome}</p>
            <p className="text-sm text-muted-foreground">{telefoneLegivel(conversa.telefone)}</p>
          </div>
        </div>
        {conversa.nome_contato &&
        conversa.cliente &&
        conversa.nome_contato.trim() !== conversa.cliente.nome.trim() ? (
          <p className="text-sm text-muted-foreground">No WhatsApp: {conversa.nome_contato}</p>
        ) : !conversa.nome_contato ? (
          <p className="text-sm text-muted-foreground">Sem nome no WhatsApp.</p>
        ) : null}
        {conversa.cliente ? (
          <p className="text-base">
            Cliente:{" "}
            <Link
              to="/clientes/$id"
              params={{ id: conversa.cliente.id }}
              className={LINK_DE_44}
            >
              {conversa.cliente.nome}
            </Link>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Sem cliente vinculado.</p>
        )}
        {conversa.lead && !conversa.cliente && (
          <p className="text-sm text-muted-foreground">
            Lead aberto pelo WhatsApp: {conversa.lead.nome ?? "sem nome"} (
            {ROTULO_LEAD[conversa.lead.status ?? ""] ?? conversa.lead.status ?? "sem situação"}).{" "}
            {hasPermission("leads.read") && (
              <Link to="/leads" className={LINK_DE_44}>
                Abrir Leads
              </Link>
            )}
          </p>
        )}
        <AcaoDeTrabalho
          icone={<Link2 className="mr-2 h-4 w-4" />}
          rotulo={conversa.cliente_id ? "Trocar o cliente" : "Vincular a um cliente"}
          d={pode.vincular_cliente}
          aoClicar={() => abrir("vincular_cliente")}
        />
      </section>

      <div className="border-b p-4">
        <EtiquetaDeTipoDoContato
          conversaId={conversa.id}
          leadId={conversa.lead_id}
          tipo={origem.data?.tipo ?? null}
          tipoOrigem={origem.data?.tipoOrigem ?? null}
          anuncioNome={origem.data?.anuncioNome ?? null}
          produto={origem.data?.produto ?? null}
          clienteCadastrado={!!conversa.cliente_id}
          parceiroCadastrado={origem.data?.parceiroCadastrado ?? false}
          somenteLeitura={!podeResponder}
          aoMudar={() => void origem.refetch()}
        />
      </div>
      <section className="space-y-2 border-b p-4" aria-labelledby="gaveta-trabalho">
        <h3 id="gaveta-trabalho" className={TITULO_DA_SECAO}>
          Transformar em trabalho
        </h3>
        <AcaoDeTrabalho
          icone={<FileText className="mr-2 h-4 w-4" />}
          rotulo="Criar orçamento"
          d={pode.orcamento}
          aoClicar={() => abrir("orcamento")}
        />
        {/* O caminho que existe para quem não abre OS direto: o orçamento, que o
            gerente converte. Dito no lugar do botão, não escondido. */}
        <AcaoDeTrabalho
          icone={<ClipboardList className="mr-2 h-4 w-4" />}
          rotulo="Criar OS"
          d={pode.os}
          aoClicar={() => abrir("os")}
        />
        {conversa.os_id && (
          <p className="text-sm">
            <Link to="/os/$id" params={{ id: conversa.os_id }} className={LINK_DE_44}>
              Abrir a OS ligada a esta conversa
            </Link>
          </p>
        )}
        <VinculosDaConversa conversa={conversa} podeEditar={podeResponder} />
      </section>

      <AtendimentosDaConversa conversaId={conversa.id} semMensagemDoCliente={semMensagemDoCliente} />

      <Etiquetas conversa={conversa} podeEditar={podeResponder} />

      <section className="p-4" aria-labelledby="gaveta-historico">
        {/* Recolhido: quem atende abre quando precisa (a1 8.6). */}
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-foreground">
            <span id="gaveta-historico">Histórico do cliente</span>
          </summary>
          <div className="space-y-3 pt-1">
            {!conversa.cliente_id ? (
              <p className="text-sm text-muted-foreground">
                Vincule a conversa a um cliente para ver os orçamentos e as OS dele aqui.
              </p>
            ) : historico.isError ? (
              <p className="text-sm text-destructive">
                Não foi possível carregar o histórico: {mensagemErro(historico.error)}
              </p>
            ) : historico.isPending ? (
              <Carregando />
            ) : (
              <div className="space-y-3 text-sm">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-muted-foreground">
                    Orçamentos recentes
                  </h4>
                  {historico.data.orcamentos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum orçamento deste cliente.</p>
                  ) : (
                    historico.data.orcamentos.map((o) => (
                      <div key={o.id} className="flex items-center justify-between gap-2">
                        <Link
                          to="/orcamentos/$id"
                          params={{ id: o.id }}
                          className="inline-flex min-h-11 items-center truncate text-link underline-offset-2 hover:underline"
                        >
                          #{o.numero} · {o.titulo}
                        </Link>
                        <StatusChip
                          label={ROTULO_ORCAMENTO[o.status] ?? o.status}
                          tone="cyan"
                          className="shrink-0"
                        />
                      </div>
                    ))
                  )}
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-muted-foreground">OS recentes</h4>
                  {historico.data.os.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma OS deste cliente.</p>
                  ) : (
                    historico.data.os.map((o) => (
                      <div key={o.id} className="flex items-center justify-between gap-2">
                        <Link
                          to="/os/$id"
                          params={{ id: o.id }}
                          className="inline-flex min-h-11 items-center truncate text-link underline-offset-2 hover:underline"
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
          </div>
        </details>
      </section>

      {!onAbrirDialogo && (
        <DialogosDaConversa conversa={conversa} qual={dialogoLocal} onQual={setDialogoLocal} />
      )}
    </Card>
  );
}

/**
 * Um botão de trabalho de 44 px. Sem permissão ou sem cliente ele fica
 * desabilitado COM o motivo à vista logo abaixo: escondido, a ação parece não
 * existir (contrato da onda 1, 3.3).
 */
function AcaoDeTrabalho({
  icone,
  rotulo,
  d,
  aoClicar,
}: {
  icone: React.ReactNode;
  rotulo: string;
  d: Disponivel;
  aoClicar: () => void;
}) {
  if (d.pode) {
    return (
      <Button variant="outline" className="h-11 w-full justify-start text-base" onClick={aoClicar}>
        {icone} {rotulo}
      </Button>
    );
  }
  return (
    <div className="space-y-1">
      <Button variant="outline" className="h-11 w-full justify-start text-base" disabled>
        {icone} {rotulo}
      </Button>
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <Lock className="mt-1 h-3.5 w-3.5 shrink-0" />
        {d.motivo}
      </p>
    </div>
  );
}

/**
 * Etiquetas gravadas em `whatsapp_conversas.etiquetas` (text[], já existia).
 * A tela antiga trocava a etiqueta só no estado da página: some no F5.
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
    <section className="space-y-2 border-b p-4" aria-labelledby="gaveta-etiquetas">
      <h3 id="gaveta-etiquetas" className={TITULO_DA_SECAO}>
        Etiquetas
        <AjudaDaSecao texto={DICAS_WA_GAVETA.etiquetas} rotulo="Etiquetas" />
      </h3>
      <div className="flex flex-wrap gap-2">
        {atuais.length === 0 && (
          <span className="text-sm text-muted-foreground">Nenhuma etiqueta.</span>
        )}
        {atuais.map((e) => (
          <span
            key={e}
            className="inline-flex min-h-11 items-center rounded-full border pl-3 text-sm"
          >
            {e}
            {podeEditar ? (
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-full"
                aria-label={`Tirar a etiqueta ${e}`}
                disabled={gravando}
                onClick={() => void salvar(removerEtiqueta(atuais, e), `Etiqueta "${e}" retirada`)}
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <span className="pr-3" />
            )}
          </span>
        ))}
      </div>
      {podeEditar && (
        <>
          <div className="flex flex-wrap gap-2">
            {sugestoes.map((s) => (
              <Button
                key={s}
                type="button"
                variant="ghost"
                className="h-11 px-3 text-sm"
                disabled={gravando}
                onClick={() => void salvar(adicionarEtiqueta(atuais, s), `Etiqueta "${s}" gravada`)}
              >
                <Plus className="mr-1 h-4 w-4" /> {s}
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
              className="h-11 text-base"
              maxLength={30}
              aria-label="Nova etiqueta"
            />
            <Button
              type="submit"
              variant="outline"
              className="h-11"
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
