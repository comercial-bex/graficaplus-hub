import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { TemplatesAutomaticosCard } from "@/components/notificacoes/templates-automaticos-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";
import { db } from "@/lib/module-data";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";
import { useAuth } from "@/lib/auth-context";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaTela } from "@/lib/dicas";
export const Route = createFileRoute("/_authenticated/respostas-rapidas")({
  head: () => ({ meta: [{ title: "Respostas rápidas — BEX PRINT OS" }] }),
  component: RespPage,
});

type Resposta = { id: string; titulo: string; categoria: string; texto: string; ativo: boolean };

/**
 * Respostas rápidas do WhatsApp.
 *
 * Até 02/10/2026 eram cadastradas aqui e nenhuma tela as lia; agora a caixa de
 * resposta de /whatsapp oferece as ATIVAS. Dois botões desta tela fingiam: o
 * "Editar" acrescentava um espaço no fim do texto e gravava (a pessoa clicava
 * e nada mudava na tela), e o "Concluir" desativava a resposta com um nome que
 * não dizia isso. Agora editar abre o texto para edição, e desativar se chama
 * desativar — e pode ser desfeito.
 */
function RespPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState("Geral");
  const [texto, setTexto] = useState("");

  const respostas = useQuery({
    queryKey: ["respostas-rapidas"],
    queryFn: async () => {
      const { data, error } = await db
        .from("respostas_rapidas")
        .select("id, titulo, categoria, texto, ativo")
        .order("categoria")
        .order("titulo");
      if (error) throw error;
      return (data ?? []) as Resposta[];
    },
  });

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["respostas-rapidas"] });
    // A caixa de entrada do WhatsApp lê as ativas por outra chave.
    void qc.invalidateQueries({ queryKey: ["wa-caixa-respostas-rapidas"] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("respostas_rapidas").insert({
        titulo: titulo.trim(),
        categoria: categoria.trim() || "Geral",
        texto: texto.trim(),
        ativo: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Resposta criada");
      setTitulo("");
      setTexto("");
      recarregar();
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      // UPDATE barrado pelo RLS não dá erro, devolve zero linhas: sem pedir a
      // linha de volta, a tela diria "salvo" com o texto antigo no banco.
      const { data, error } = await db
        .from("respostas_rapidas")
        .update(changes)
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error("Seu perfil não pode alterar esta resposta rápida.");
    },
    onSuccess: () => recarregar(),
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const lista = respostas.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Respostas rápidas</h1>
            <DicaIcone
              texto={dicaTela("/respostas-rapidas")}
              rotulo="Respostas rápidas"
              lado="bottom"
              className="h-5 w-5"
            />
          </div>
          <p className="text-muted-foreground">
            Mensagens prontas para o WhatsApp. As ativas aparecem no botão de respostas rápidas da{" "}
            {hasPermission("whatsapp.read") ? (
              <Link to="/whatsapp" className="text-primary underline underline-offset-2">
                caixa de entrada
              </Link>
            ) : (
              "caixa de entrada"
            )}
            .
          </p>
        </div>
      </div>

      {/* Os textos dos avisos automáticos são de quem tem templates.manage: a
          policy de notificacao_templates recusa a gravação dos outros. */}
      {hasPermission("templates.manage") && <TemplatesAutomaticosCard />}

      <Card>
        <CardHeader>
          <CardTitle>
            <Plus className="h-4 w-4 inline mr-2" />
            Nova resposta
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-[180px_220px_1fr_auto] md:items-start">
          <Input
            placeholder="Categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            aria-label="Categoria"
          />
          <Input
            placeholder="Título"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            aria-label="Título"
          />
          <Textarea
            placeholder="Texto que vai para o cliente"
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            aria-label="Texto"
          />
          <Button
            onClick={() => create.mutate()}
            disabled={!titulo.trim() || !texto.trim() || create.isPending}
          >
            Criar
          </Button>
        </CardContent>
      </Card>

      {respostas.isError ? (
        <FalhaDeConsulta
          titulo="Não foi possível carregar as respostas rápidas"
          erro={respostas.error}
          onTentarDeNovo={() => void respostas.refetch()}
        />
      ) : respostas.isPending ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : lista.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhuma resposta rápida cadastrada. As que você criar aparecem na caixa de resposta do
          WhatsApp.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {lista.map((r) => (
            <CartaoDeResposta
              key={r.id}
              resposta={r}
              salvando={update.isPending}
              onSalvar={(changes) => update.mutateAsync({ id: r.id, changes })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CartaoDeResposta({
  resposta,
  salvando,
  onSalvar,
}: {
  resposta: Resposta;
  salvando: boolean;
  onSalvar: (changes: Record<string, unknown>) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState({ titulo: "", categoria: "", texto: "" });

  function abrirEdicao() {
    setRascunho({ titulo: resposta.titulo, categoria: resposta.categoria, texto: resposta.texto });
    setEditando(true);
  }

  async function salvar() {
    if (!rascunho.titulo.trim() || !rascunho.texto.trim()) {
      toast.error("Título e texto são obrigatórios");
      return;
    }
    try {
      await onSalvar({
        titulo: rascunho.titulo.trim(),
        categoria: rascunho.categoria.trim() || "Geral",
        texto: rascunho.texto.trim(),
      });
      toast.success("Resposta atualizada");
      setEditando(false);
    } catch {
      // o erro já foi dito pelo onError da mutação; o rascunho fica aberto
    }
  }

  async function alternarAtivo() {
    try {
      await onSalvar({ ativo: !resposta.ativo });
      toast.success(
        resposta.ativo ? "Resposta desativada — some da caixa de entrada" : "Resposta reativada",
      );
    } catch {
      // idem: o onError da mutação já avisou
    }
  }

  return (
    <Card className={!resposta.ativo ? "opacity-60" : undefined}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{resposta.titulo}</CardTitle>
          <div className="flex items-center gap-1">
            {!resposta.ativo && <Badge variant="secondary">desativada</Badge>}
            <Badge variant="outline">{resposta.categoria}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {editando ? (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={rascunho.categoria}
                onChange={(e) => setRascunho({ ...rascunho, categoria: e.target.value })}
                aria-label="Categoria"
              />
              <Input
                value={rascunho.titulo}
                onChange={(e) => setRascunho({ ...rascunho, titulo: e.target.value })}
                aria-label="Título"
              />
            </div>
            <Textarea
              rows={4}
              value={rascunho.texto}
              onChange={(e) => setRascunho({ ...rascunho, texto: e.target.value })}
              aria-label="Texto"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void salvar()} disabled={salvando}>
                Salvar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditando(false)}
                disabled={salvando}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{resposta.texto}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={abrirEdicao} disabled={salvando}>
                Editar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void alternarAtivo()}
                disabled={salvando}
              >
                {resposta.ativo ? "Desativar" : "Reativar"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
