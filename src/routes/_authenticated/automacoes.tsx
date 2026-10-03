/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaTela } from "@/lib/dicas";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { formatDateTime } from "@/lib/module-data";
import { AutomacaoDialog } from "@/components/automacoes/automacao-dialog";
import { ModelosProntos } from "@/components/automacoes/modelos-prontos";
import { ExecucoesRecentes } from "@/components/automacoes/execucoes-recentes";
import { SaudeDoEnvio, useSaudeDoEnvio } from "@/components/automacoes/saude-do-envio";
import {
  FORM_VAZIO,
  lerAutomacao,
  resumoDaAutomacao,
  type FormAutomacao,
  type LinhaAutomacao,
} from "@/domain/automacoes/formulario";

export const Route = createFileRoute("/_authenticated/automacoes")({
  head: () => ({ meta: [{ title: "Automações — BEX PRINT OS" }] }),
  component: AutoPage,
});

type Automacao = LinhaAutomacao & { ultima_execucao: string | null; created_at: string };

/**
 * Automações de WhatsApp: criar, editar, ligar e desligar — e ver o que saiu.
 *
 * Antes a tela só tinha o interruptor de automações que existissem, e havia 0:
 * a tela nunca tinha conteúdo. Pior, o motor estava morto (comparação text =
 * enum engolida por um EXCEPTION mudo): mesmo com automação cadastrada, nada
 * entrava na fila. A migração 20261002103002 conserta o motor; esta tela só
 * oferece o que ele executa (domain/automacoes/catalogo.ts) e diz, no alto, o
 * que ainda impede a mensagem de sair.
 */
function AutoPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  // A policy RESTRICTIVE de escrita pede automacoes.manage: o botão segue a
  // mesma régua do banco.
  const podeGerenciar = hasPermission("automacoes.manage");
  const saude = useSaudeDoEnvio();
  const [editor, setEditor] = useState<{ inicial: FormAutomacao; id: string | null } | null>(null);

  const lista = useQuery({
    queryKey: ["automacoes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("automacoes")
        .select(
          "id, nome, descricao, gatilho, condicao, acao, payload, ativo, cooldown_segundos, delay_segundos, ultima_execucao, created_at",
        )
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Automacao[];
    },
  });

  const alternar = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { data, error } = await (supabase as any)
        .from("automacoes")
        .update({ ativo })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // RLS que barra UPDATE devolve 0 linhas, sem erro.
      if (!data || data.length === 0) {
        throw new Error(
          "Nada foi alterado: seu perfil não tem permissão para ligar ou desligar automações (automacoes.manage).",
        );
      }
      return ativo;
    },
    onSuccess: (ativo) => {
      qc.invalidateQueries({ queryKey: ["automacoes"] });
      qc.invalidateQueries({ queryKey: ["automacao_execucoes"] });
      qc.invalidateQueries({ queryKey: ["automacoes-saude"] });
      if (!ativo) {
        toast.success("Desligada. O que ela tinha na fila foi cancelado.");
      } else if (!saude.funciona) {
        toast.warning(
          "Ligada, mas nada sai enquanto o WhatsApp ou o processador da fila não estiverem funcionando. As mensagens ficam na fila.",
        );
      } else {
        toast.success("Ligada.");
      }
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  // Nasce ligada só quando a mensagem já consegue sair. Ligada com o WhatsApp
  // desconectado, ela enfileira em silêncio — e quando o WhatsApp voltar sai
  // tudo de uma vez, inclusive aviso de coisa que já se resolveu.
  function abrirNova(form: FormAutomacao) {
    setEditor({ inicial: { ...form, ativo: saude.funciona }, id: null });
  }

  const automacoes = lista.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Automações de WhatsApp</h1>
            <DicaIcone
              texto={dicaTela("/automacoes")}
              rotulo="Automações de WhatsApp"
              lado="bottom"
              className="h-5 w-5"
            />
          </div>
          <p className="text-muted-foreground">
            Regras que mandam uma mensagem sozinhas quando algo acontece no sistema
          </p>
        </div>
        {podeGerenciar && (
          <Button onClick={() => abrirNova(FORM_VAZIO)}>
            <Plus className="h-4 w-4 mr-1" /> Nova automação
          </Button>
        )}
      </div>

      <SaudeDoEnvio saude={saude} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Automações{lista.data ? ` (${automacoes.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!podeGerenciar && (
            <p className="text-xs text-muted-foreground">
              Você vê as automações, mas criar, editar, ligar e desligar pede a permissão
              automacoes.manage.
            </p>
          )}
          {lista.isError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Não foi possível carregar as automações</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{mensagemErro(lista.error)}</p>
                <p>Isto é uma falha de consulta, não uma lista vazia.</p>
                <Button variant="outline" size="sm" onClick={() => void lista.refetch()}>
                  Tentar de novo
                </Button>
              </AlertDescription>
            </Alert>
          ) : lista.isPending ? (
            <p className="text-sm text-muted-foreground">Carregando automações…</p>
          ) : automacoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma automação ainda.
              {podeGerenciar &&
                " Comece por um dos modelos prontos abaixo ou crie a sua em “Nova automação”."}
            </p>
          ) : (
            automacoes.map((a) => {
              const r = resumoDaAutomacao(a);
              const mensagem = typeof a.payload?.mensagem === "string" ? a.payload.mensagem : "";
              return (
                <div
                  key={a.id}
                  className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{a.nome}</p>
                      {a.ativo ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Ligada</Badge>
                      ) : (
                        <Badge variant="outline">Desligada</Badge>
                      )}
                    </div>
                    <p className="text-sm">
                      <span className="text-muted-foreground">Quando: </span>
                      {r.quando}
                      {r.condicao ? ` — ${r.condicao}` : ""}
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">Para: </span>
                      {r.destino} · {r.intervalo}
                      {r.espera ? ` · ${r.espera}` : ""}
                    </p>
                    {mensagem && (
                      <p className="text-sm text-muted-foreground line-clamp-2">“{mensagem}”</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {a.ultima_execucao
                        ? `Último envio: ${formatDateTime(a.ultima_execucao)}`
                        : "Ainda não enviou nenhuma mensagem"}
                    </p>
                    {r.problema && (
                      <p className="flex items-start gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{" "}
                        {r.problema}
                      </p>
                    )}
                  </div>
                  {podeGerenciar && (
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditor({ inicial: lerAutomacao(a), id: a.id })}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                      </Button>
                      <Switch
                        checked={a.ativo}
                        disabled={alternar.isPending}
                        aria-label={a.ativo ? `Desligar ${a.nome}` : `Ligar ${a.nome}`}
                        onCheckedChange={(ativo) => alternar.mutate({ id: a.id, ativo })}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {podeGerenciar && <ModelosProntos onUsar={abrirNova} />}

      <ExecucoesRecentes />

      {podeGerenciar && (
        <AutomacaoDialog
          aberto={editor !== null}
          onAbertoChange={(aberto) => {
            if (!aberto) setEditor(null);
          }}
          inicial={editor?.inicial ?? FORM_VAZIO}
          automacaoId={editor?.id ?? null}
          envioFunciona={saude.funciona}
        />
      )}
    </div>
  );
}
