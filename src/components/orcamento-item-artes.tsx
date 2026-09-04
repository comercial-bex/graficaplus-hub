import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Images, Loader2, Star, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { mensagemErro } from "@/lib/erros";

/**
 * Artes de um item do orçamento.
 *
 * Um mesmo produto costuma ter várias artes (frente, verso, variações). A que
 * estiver marcada como capa é a miniatura que sai no PDF e no link do cliente;
 * as outras ficam listadas logo abaixo.
 */
type Arte = {
  vinculo_id: string;
  arquivo_id: string;
  nome: string;
  capa: boolean;
  url: string | null;
};

export function OrcamentoItemArtes({
  itemId,
  orcamentoId,
  clienteId,
}: {
  itemId: string;
  orcamentoId: string;
  clienteId?: string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const chave = ["orc-item-artes", itemId];

  const { data: artes = [], isLoading } = useQuery({
    queryKey: chave,
    enabled: open,
    queryFn: async (): Promise<Arte[]> => {
      const { data: vinculos, error } = await (supabase as any)
        .from("orcamento_item_arquivos")
        .select("id, arquivo_id, capa, ordem")
        .eq("item_id", itemId)
        .order("capa", { ascending: false })
        .order("ordem");
      if (error) throw error;

      const lista = (vinculos ?? []) as {
        id: string;
        arquivo_id: string;
        capa: boolean;
      }[];
      if (lista.length === 0) return [];

      const { data: arquivos } = await supabase
        .from("arquivos")
        .select("id, nome, caminho")
        .in(
          "id",
          lista.map((v) => v.arquivo_id),
        );
      const porId = new Map(
        ((arquivos ?? []) as { id: string; nome: string; caminho: string }[]).map((a) => [a.id, a]),
      );

      return Promise.all(
        lista.map(async (v) => {
          const arq = porId.get(v.arquivo_id);
          let url: string | null = null;
          if (arq) {
            const { data } = await supabase.storage
              .from("arquivos-clientes")
              .createSignedUrl(arq.caminho, 600);
            url = data?.signedUrl ?? null;
          }
          return {
            vinculo_id: v.id,
            arquivo_id: v.arquivo_id,
            nome: arq?.nome ?? "arquivo",
            capa: v.capa,
            url,
          };
        }),
      );
    },
  });

  async function enviarArquivos(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    setEnviando(true);
    try {
      let ordem = artes.length;
      for (const arquivo of Array.from(arquivos)) {
        const extensao = arquivo.name.split(".").pop() ?? "bin";
        const caminho = `orcamento/${orcamentoId}/${crypto.randomUUID()}.${extensao}`;
        const { error: erroUpload } = await supabase.storage
          .from("arquivos-clientes")
          .upload(caminho, arquivo, { contentType: arquivo.type });
        if (erroUpload) throw erroUpload;

        const { data: registro, error: erroRegistro } = await supabase
          .from("arquivos")
          .insert({
            nome: arquivo.name,
            caminho,
            tipo: "arte",
            cliente_id: clienteId ?? null,
            tamanho_bytes: arquivo.size,
          } as never)
          .select("id")
          .single();
        if (erroRegistro) throw erroRegistro;

        const primeira = artes.length === 0 && ordem === 0;
        const { error: erroVinculo } = await (supabase as any)
          .from("orcamento_item_arquivos")
          .insert({
            item_id: itemId,
            arquivo_id: (registro as { id: string }).id,
            capa: primeira,
            ordem,
          });
        if (erroVinculo) throw erroVinculo;
        if (primeira) {
          await supabase
            .from("orcamento_itens")
            .update({ arquivo_id: (registro as { id: string }).id } as never)
            .eq("id", itemId);
        }
        ordem += 1;
      }
      toast.success(arquivos.length > 1 ? "Artes anexadas" : "Arte anexada");
      await qc.invalidateQueries({ queryKey: chave });
      await qc.invalidateQueries({ queryKey: ["orc-itens", orcamentoId] });
    } catch (e) {
      toast.error(mensagemErro(e, "Falha ao enviar a arte"));
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const definirCapa = useMutation({
    mutationFn: async (arte: Arte) => {
      await (supabase as any)
        .from("orcamento_item_arquivos")
        .update({ capa: false })
        .eq("item_id", itemId);
      const { error } = await (supabase as any)
        .from("orcamento_item_arquivos")
        .update({ capa: true })
        .eq("id", arte.vinculo_id);
      if (error) throw error;
      await supabase
        .from("orcamento_itens")
        .update({ arquivo_id: arte.arquivo_id } as never)
        .eq("id", itemId);
    },
    onSuccess: async () => {
      toast.success("Capa definida");
      await qc.invalidateQueries({ queryKey: chave });
      await qc.invalidateQueries({ queryKey: ["orc-itens", orcamentoId] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível definir a capa")),
  });

  const remover = useMutation({
    mutationFn: async (arte: Arte) => {
      const { error } = await (supabase as any)
        .from("orcamento_item_arquivos")
        .delete()
        .eq("id", arte.vinculo_id);
      if (error) throw error;
      if (arte.capa) {
        const restante = artes.find((a) => a.vinculo_id !== arte.vinculo_id);
        await supabase
          .from("orcamento_itens")
          .update({ arquivo_id: restante?.arquivo_id ?? null } as never)
          .eq("id", itemId);
        if (restante) {
          await (supabase as any)
            .from("orcamento_item_arquivos")
            .update({ capa: true })
            .eq("id", restante.vinculo_id);
        }
      }
    },
    onSuccess: async () => {
      toast.success("Arte removida");
      await qc.invalidateQueries({ queryKey: chave });
      await qc.invalidateQueries({ queryKey: ["orc-itens", orcamentoId] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível remover a arte")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Artes do item">
          <Images className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Artes do item</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => void enviarArquivos(e.target.files)}
            />
            <Button
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={enviando}
            >
              {enviando ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              Anexar artes
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              A arte marcada com a estrela é a que aparece no orçamento em PDF e no link do
              cliente.
            </p>
          </div>

          {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {!isLoading && artes.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma arte anexada a este item.</p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {artes.map((a) => (
              <div key={a.vinculo_id} className="rounded-lg border overflow-hidden">
                <div className="h-24 bg-muted grid place-items-center overflow-hidden">
                  {a.url ? (
                    <img
                      src={a.url}
                      alt={`Arte ${a.nome}`}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">sem preview</span>
                  )}
                </div>
                <div className="p-2 space-y-1">
                  <div className="truncate text-xs" title={a.nome}>
                    {a.nome}
                  </div>
                  <div className="flex items-center justify-between">
                    <Button
                      size="sm"
                      variant={a.capa ? "default" : "ghost"}
                      onClick={() => definirCapa.mutate(a)}
                      disabled={a.capa || definirCapa.isPending}
                      title="Usar como capa"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remover.mutate(a)}
                      disabled={remover.isPending}
                      title="Remover arte"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
