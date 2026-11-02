/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { supabase } from "@/integrations/supabase/client";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import {
  ensaiarAtendimento,
  repetirTurno,
  type RespostaDoEnsaio,
} from "@/lib/api/atendente-ensaio.functions";
import type { DecisaoDoAtendente, FalaDaConversa, ItemDoAtendente, TipoDaMensagem } from "@/domain/whatsapp/atendente";

export const Route = createFileRoute("/_authenticated/atendente-ensaio")({
  head: () => ({ meta: [{ title: "Ensaio do atendente — BEX PRINT OS" }] }),
  component: EnsaioDoAtendente,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">Erro: {(error as Error).message}</div>
  ),
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const FRASE_DA_FALHA: Record<string, string> = {
  sem_ia: "A IA não está ligada neste projeto: falta a chave no servidor.",
  sem_roteiro: "Nenhum produto está liberado para a IA.",
  limite: "Muitas chamadas seguidas. Espere um minuto e tente de novo.",
  sem_saldo: "O saldo de IA acabou.",
};

function fraseDaFalha(r: Exclude<RespostaDoEnsaio, { estado: "ok" }>) {
  return r.estado === "falhou" ? `A IA não respondeu: ${r.detalhe}.` : FRASE_DA_FALHA[r.estado];
}

/**
 * O ensaio do atendente automático. Nada aqui chega ao cliente: a conversa fica na tela, e a réplica só compara com o
 * que a equipe respondeu de verdade.
 */
function EnsaioDoAtendente() {
  return (
    <div className="space-y-4">
      <SectionHeader
        ajuda={dicaTela("/atendente-ensaio")}
        breadcrumb="Atendimento · WhatsApp"
        title="Ensaio do atendente"
        description="Teste o atendente automático antes de ele falar com cliente. Nada desta tela sai pelo WhatsApp."
      />
      <Tabs defaultValue="ensaio">
        <TabsList>
          <TabsTrigger value="ensaio">Ensaio</TabsTrigger>
          <TabsTrigger value="replica">Réplica das conversas</TabsTrigger>
        </TabsList>
        <TabsContent value="ensaio" className="pt-2">
          <Ensaio />
        </TabsContent>
        <TabsContent value="replica" className="pt-2">
          <Replica />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Ensaio() {
  const [historico, setHistorico] = useState<FalaDaConversa[]>([]);
  const [texto, setTexto] = useState("");
  const [ultima, setUltima] = useState<{ decisao: DecisaoDoAtendente; itens: ItemDoAtendente[]; confianca: number | null } | null>(null);
  const enviar = useMutation({
    mutationFn: async ({ mensagem, tipo }: { mensagem: string; tipo: TipoDaMensagem }) => {
      const r = await ensaiarAtendimento({ data: { historico, mensagem, tipo } });
      return { r, fala: mensagem || `[${tipo} enviada]` };
    },
    onSuccess: ({ r, fala }) => {
      if (r.estado !== "ok") {
        toast.error(fraseDaFalha(r));
        return;
      }
      setHistorico((h) => [...h, { de: "cliente", texto: fala }, { de: "grafica", texto: r.decisao.texto }]);
      setUltima({ decisao: r.decisao, itens: r.itens, confianca: r.confianca });
      setTexto("");
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const mandar = (tipo: TipoDaMensagem) => enviar.mutate({ mensagem: texto.trim(), tipo });

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Você é o cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-[50vh] space-y-2 overflow-y-auto" data-testid="conversa-do-ensaio">
            {historico.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Escreva como um cliente escreveria no WhatsApp. Ex.: quanto fica um banner?
              </p>
            )}
            {historico.map((h, i) => (
              <div
                key={i}
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg border p-2 text-sm ${h.de === "cliente" ? "ml-auto bg-muted" : "bg-card"}`}
              >
                {h.texto}
              </div>
            ))}
            {enviar.isPending && <p className="text-xs text-muted-foreground">O atendente está respondendo...</p>}
          </div>
          <Textarea
            rows={2}
            aria-label="Mensagem do cliente"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Mensagem do cliente"
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={enviar.isPending || !texto.trim()} onClick={() => mandar("texto")}>
              Enviar
            </Button>
            <Button variant="outline" disabled={enviar.isPending} onClick={() => mandar("imagem")}>
              Mandou foto
            </Button>
            <Button variant="outline" disabled={enviar.isPending} onClick={() => mandar("documento")}>
              Mandou PDF
            </Button>
            <Button variant="outline" disabled={enviar.isPending} onClick={() => mandar("audio")}>
              Mandou áudio
            </Button>
            <Button
              variant="ghost"
              disabled={enviar.isPending || historico.length === 0}
              onClick={() => {
                setHistorico([]);
                setUltima(null);
              }}
            >
              Começar de novo
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">O que o atendente entendeu</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm" data-testid="leitura-do-ensaio">
          {!ultima && <p className="text-muted-foreground">Aparece aqui depois da primeira resposta.</p>}
          {ultima && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={ultima.decisao.acao === "transferir" ? "secondary" : "default"}>
                  {ultima.decisao.acao === "transferir" ? "Passou para a equipe" : "Respondeu sozinho"}
                </Badge>
                {ultima.confianca != null && (
                  <span className="text-xs text-muted-foreground">Certeza de {Math.round(ultima.confianca * 100)}%</span>
                )}
              </div>
              {ultima.decisao.motivo && <p className="text-xs">Motivo: {ultima.decisao.motivo}</p>}
              {ultima.itens.map((i, n) => (
                <div key={n} className="rounded border p-2">
                  <div className="font-medium">{i.nome}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.quantidade.toLocaleString("pt-BR")} {i.unidade}
                    {i.largura_m && i.altura_m ? ` · ${i.largura_m} × ${i.altura_m} m` : " · sem medida"}
                  </div>
                  {i.respostas.map((r) => (
                    <div key={r.pergunta_id} className="text-xs text-muted-foreground">
                      {r.pergunta}: {Array.isArray(r.resposta) ? r.resposta.join(", ") : r.resposta}
                    </div>
                  ))}
                </div>
              ))}
              {ultima.decisao.previa && ultima.decisao.previa.linhas.length > 0 && (
                <div className="rounded border p-2">
                  <div className="font-medium">Conta da tabela</div>
                  {ultima.decisao.previa.linhas.map((l, n) => (
                    <div key={n} className="flex justify-between gap-2 text-xs">
                      <span>{l.descricao}</span>
                      <span className="font-mono">{brl(l.total)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between gap-2 font-semibold">
                    <span>Total</span>
                    <span className="font-mono">{brl(ultima.decisao.previa.total)}</span>
                  </div>
                </div>
              )}
              {(ultima.decisao.previa?.pendencias ?? []).map((p) => (
                <p key={p} className="text-xs text-destructive">
                  {p}
                </p>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Replica() {
  const qc = useQueryClient();
  const [rodando, setRodando] = useState<string | null>(null);
  const [progresso, setProgresso] = useState("");
  const conversas = useQuery({
    queryKey: ["replica-conversas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_conversas")
        .select("id, nome_contato, ultima_mensagem_at")
        .order("ultima_mensagem_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as { id: string; nome_contato: string | null; ultima_mensagem_at: string | null }[];
    },
  });
  const ensaios = useQuery({
    queryKey: ["replica-ensaios"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("atendente_ensaios")
        .select("id, conversa_id, ordem, mensagem_cliente, tipo_mensagem, resposta_ia, resposta_equipe, acao, motivo, valor, avaliacao")
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const repetir = async (id: string) => {
    setRodando(id);
    try {
      let total = 1;
      let falhou = false;
      for (let ordem = 0; ordem < total; ordem++) {
        setProgresso(total > 1 ? `${ordem + 1} de ${total}` : "");
        const r = await repetirTurno({ data: { conversa_id: id, ordem } });
        total = r.total;
        if (r.falha) {
          toast.error(`Parou na mensagem ${ordem + 1}: ${r.falha}.`);
          falhou = true;
          break;
        }
        await qc.invalidateQueries({ queryKey: ["replica-ensaios"] });
      }
      if (total === 0) toast.info("Esta conversa não tem mensagem do cliente.");
      else if (!falhou) toast.success(`${total} mensagens repetidas.`);
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setRodando(null);
    }
  };
  const avaliar = useMutation({
    mutationFn: async ({ id, avaliacao }: { id: string; avaliacao: "certo" | "errado" }) => {
      const { data, error } = await (supabase as any)
        .from("atendente_ensaios")
        .update({ avaliacao })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("A avaliação não foi gravada.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["replica-ensaios"] }),
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const lista = ensaios.data ?? [];
  const avaliados = lista.filter((e) => e.avaliacao);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap gap-6 pt-6 text-sm" data-testid="placar-da-replica">
          <Numero rotulo="Mensagens repetidas" valor={lista.length} />
          <Numero rotulo="Respondeu sozinho" valor={lista.filter((e) => e.acao === "responder").length} />
          <Numero rotulo="Passou para a equipe" valor={lista.filter((e) => e.acao === "transferir").length} />
          <Numero rotulo="Avaliadas como certas" valor={`${avaliados.filter((e) => e.avaliacao === "certo").length} de ${avaliados.length}`} />
        </CardContent>
      </Card>
      {(conversas.data ?? []).map((c) => {
        const deles = lista.filter((e) => e.conversa_id === c.id);
        return (
          <Card key={c.id}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{c.nome_contato ?? "Sem nome"}</CardTitle>
              <Button size="sm" variant="outline" disabled={rodando !== null} onClick={() => void repetir(c.id)}>
                {rodando === c.id ? `Repetindo ${progresso}...` : deles.length > 0 ? "Repetir de novo" : "Repetir conversa"}
              </Button>
            </CardHeader>
            {deles.length > 0 && (
              <CardContent className="space-y-3">
                {deles.map((e) => (
                  <div key={e.id} className="space-y-1 rounded border p-2 text-sm">
                    <p className="whitespace-pre-wrap">
                      <strong>Cliente:</strong> {e.mensagem_cliente}
                    </p>
                    <p className="whitespace-pre-wrap">
                      <strong>Atendente:</strong> {e.resposta_ia}
                    </p>
                    {e.motivo && <p className="text-xs text-muted-foreground">Passou para a equipe: {e.motivo}</p>}
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      <strong>A equipe respondeu:</strong> {e.resposta_equipe ?? "(sem resposta)"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant={e.avaliacao === "certo" ? "default" : "outline"} onClick={() => avaliar.mutate({ id: e.id, avaliacao: "certo" })}>
                        Certo
                      </Button>
                      <Button size="sm" variant={e.avaliacao === "errado" ? "default" : "outline"} onClick={() => avaliar.mutate({ id: e.id, avaliacao: "errado" })}>
                        Errado
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number | string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="text-lg font-semibold">{valor}</div>
    </div>
  );
}
