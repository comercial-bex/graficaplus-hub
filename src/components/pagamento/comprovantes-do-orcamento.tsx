/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { pedirEnvioDoComprovante, registrarComprovante, urlDoComprovante } from "@/lib/api/orcamento-comprovante.functions";
import { problemaNoComprovante } from "@/domain/pagamento/comprovante";
import { VisualizadorDeArquivo } from "@/components/arquivos/visualizador-de-arquivo";

export type ComprovanteDoOrcamento = {
  id: string;
  nome: string;
  origem: "cliente" | "equipe";
  created_at: string;
  conferido_em: string | null;
};

export function useComprovantesDoOrcamento(orcamentoId: string) {
  return useQuery({
    queryKey: ["orcamento-comprovantes", orcamentoId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orcamento_comprovantes")
        .select("id, nome, origem, created_at, conferido_em")
        .eq("orcamento_id", orcamentoId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ComprovanteDoOrcamento[];
    },
  });
}

/** Comprovantes do orçamento: lista, vê dentro do sistema e anexa um novo (foto ou PDF). */
export function ComprovantesDoOrcamento({ orcamentoId, podeAnexar }: { orcamentoId: string; podeAnexar: boolean }) {
  const qc = useQueryClient();
  const lista = useComprovantesDoOrcamento(orcamentoId);
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [vendo, setVendo] = useState<{ titulo: string; nome: string; url: string } | null>(null);

  async function enviar(arquivo: File) {
    const dados = { nome: arquivo.name, tipo: arquivo.type, tamanho: arquivo.size };
    const problema = problemaNoComprovante(dados);
    if (problema) return toast.error(problema);
    setEnviando(true);
    try {
      const pedido = await pedirEnvioDoComprovante({ data: { orcamentoId, ...dados } });
      const { error } = await supabase.storage.from("comprovantes").uploadToSignedUrl(pedido.caminho, pedido.token, arquivo, {
        contentType: arquivo.type,
      });
      if (error) throw error;
      await registrarComprovante({ data: { orcamentoId, caminho: pedido.caminho, ...dados } });
      toast.success("Comprovante anexado");
      await qc.invalidateQueries({ queryKey: ["orcamento-comprovantes", orcamentoId] });
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível anexar o comprovante"));
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  async function ver(c: ComprovanteDoOrcamento) {
    try {
      const r = await urlDoComprovante({ data: { id: c.id } });
      setVendo({ titulo: `Comprovante · ${c.nome}`, nome: r.nome, url: r.url });
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível abrir o comprovante"));
    }
  }

  const itens = lista.data ?? [];
  return (
    <div className="space-y-2" data-testid="comprovantes-do-orcamento">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Comprovante do pagamento</p>
        {podeAnexar && (
          <>
            <input
              ref={entrada}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && void enviar(e.target.files[0])}
            />
            <Button type="button" size="sm" variant="outline" disabled={enviando} onClick={() => entrada.current?.click()}>
              {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1.5 h-4 w-4" />}
              Anexar comprovante
            </Button>
          </>
        )}
      </div>
      {itens.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum comprovante anexado. Pix pago por fora precisa do comprovante.</p>
      ) : (
        <ul className="space-y-1">
          {itens.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
              <span className="min-w-0 truncate">
                {c.nome}{" "}
                <Badge variant={c.origem === "cliente" ? "default" : "secondary"} className="ml-1 font-normal">
                  {c.origem === "cliente" ? "enviado pelo cliente" : "anexado pela equipe"}
                </Badge>
                <span className="ml-2 text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </span>
              <Button type="button" size="sm" variant="ghost" aria-label="Ver o comprovante" onClick={() => void ver(c)}>
                <Eye className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <VisualizadorDeArquivo alvo={vendo} onFechar={() => setVendo(null)} />
    </div>
  );
}
