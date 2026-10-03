/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/module-data";
import { mensagemErro } from "@/lib/erros";

type Comentario = { id: string; autor_nome: string | null; comentario: string; created_at: string };

const LIMITE = 2000;

/**
 * Recados sobre a arte — e SÓ recado.
 *
 * Antes este botão, com o ícone de balão, chamava `concluir`: quem queria
 * comentar marcava a arte como final de produção e ela sumia da fila. Agora
 * ele abre o campo e grava em `arquivo_comentarios` pela função
 * `comentar_arte`, que carimba o autor pela sessão (migração 20261002103001).
 * Comentar não aprova, não pede ajuste e não conclui nada.
 */
export function ComentariosDaArte({
  arquivoId,
  nome,
  total,
}: {
  arquivoId: string;
  nome: string;
  total: number;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");

  const lista = useQuery({
    queryKey: ["arte-comentarios", arquivoId],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("arquivo_comentarios")
        .select("id, autor_nome, comentario, created_at")
        .eq("arquivo_id", arquivoId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Comentario[];
    },
  });

  const enviar = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("comentar_arte", {
        p_arquivo_id: arquivoId,
        p_comentario: texto,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTexto("");
      toast.success("Comentário gravado");
      qc.invalidateQueries({ queryKey: ["arte-comentarios", arquivoId] });
      qc.invalidateQueries({ queryKey: ["design-fila"] });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  const vazio = texto.trim().length === 0;

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" title="Ver e escrever comentários sobre esta arte">
          <MessageSquare className="h-3.5 w-3.5 mr-1" />
          Comentar{total > 0 ? ` (${total})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Comentários da arte</DialogTitle>
          <DialogDescription className="truncate" title={nome}>
            {nome} — comentar não aprova nem conclui a arte.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-3 overflow-y-auto">
          {lista.isError ? (
            <p className="text-sm text-destructive">
              Não foi possível carregar os comentários: {mensagemErro(lista.error)}
            </p>
          ) : lista.isPending ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : lista.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>
          ) : (
            lista.data.map((c) => (
              <div key={c.id} className="rounded-md border p-2 text-sm">
                <div className="mb-1 text-xs text-muted-foreground">
                  {c.autor_nome ?? "Autor sem cadastro"} · {formatDateTime(c.created_at)}
                </div>
                <p className="whitespace-pre-wrap">{c.comentario}</p>
              </div>
            ))
          )}
        </div>

        <div className="space-y-1">
          <Textarea
            aria-label="Novo comentário"
            rows={3}
            maxLength={LIMITE}
            placeholder="Ex.: o telefone do rodapé está errado; conferir a cor do logo."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <p className="text-right text-[11px] text-muted-foreground">
            {texto.length}/{LIMITE}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setAberto(false)}>
            Fechar
          </Button>
          <Button disabled={vazio || enviar.isPending} onClick={() => enviar.mutate()}>
            {enviar.isPending ? "Gravando…" : "Gravar comentário"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
