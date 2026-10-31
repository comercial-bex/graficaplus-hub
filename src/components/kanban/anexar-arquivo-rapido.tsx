import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";

/**
 * Anexar o arquivo direto da ficha do quadro (30/10/2026).
 *
 * Havia OS parada em "Sem arquivo final de produção" e OS concluída sem arte, e o
 * único caminho era abrir a OS completa. Aqui o arquivo sobe pelo mesmo caminho da
 * tela da OS (bucket `arquivos-clientes`, linha em `arquivos`, trilha em
 * `logs_auditoria`), e quem pode marcar o arquivo final já marca no mesmo gesto.
 * A marcação é conferida: a política de UPDATE barra em silêncio (0 linhas, sem
 * erro), e dizer "marcado" sem ter marcado é o defeito que o sistema já teve.
 */
export function AnexarArquivoRapido({
  osId,
  semArquivoFinal,
}: {
  osId: string;
  /** A OS ainda não tem arquivo final: o arquivo enviado já nasce como final. */
  semArquivoFinal: boolean;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const entrada = useRef<HTMLInputElement>(null);
  const enviandoRef = useRef(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo || enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const caminho = `${osId}/${Date.now()}_${arquivo.name}`;
      const { error: upErr } = await supabase.storage.from("arquivos-clientes").upload(caminho, arquivo);
      if (upErr) throw upErr;
      const { data: novo, error } = await (supabase as any)
        .from("arquivos")
        .insert({
          os_id: osId,
          nome: arquivo.name,
          caminho,
          mime_type: arquivo.type,
          tamanho_bytes: arquivo.size,
          enviado_por: user?.id,
          versao: 1,
        })
        .select("id")
        .single();
      if (error) throw error;
      await supabase.from("logs_auditoria").insert({
        entidade: "arquivos",
        entidade_id: novo?.id,
        acao: "upload",
        detalhes: { os_id: osId, nome: arquivo.name, origem: "ficha_do_quadro" },
        usuario_id: user?.id,
      });

      let final = false;
      if (semArquivoFinal && novo?.id) {
        const { data: marcado, error: marcaErr } = await (supabase as any)
          .from("arquivos")
          .update({ final_producao: true })
          .eq("id", novo.id)
          .select("id");
        final = !marcaErr && !!marcado && marcado.length > 0;
      }
      if (final) toast.success("Arquivo anexado e marcado como final de produção.");
      else if (semArquivoFinal)
        toast.warning("Arquivo anexado, mas o seu perfil não pode marcá-lo como final. Peça a quem pode.");
      else toast.success("Arquivo anexado.");

      void qc.invalidateQueries({ queryKey: ["kanban-os"] });
      void qc.invalidateQueries({ queryKey: ["kanban-bloqueios"] });
      void qc.invalidateQueries({ queryKey: ["arquivos-os", osId] });
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  return (
    <>
      <input ref={entrada} type="file" className="hidden" onChange={enviar} aria-label="Escolher arquivo para anexar" />
      <Button type="button" size="sm" variant="outline" disabled={enviando} onClick={() => entrada.current?.click()}>
        <Paperclip className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {enviando ? "Enviando..." : "Anexar arquivo"}
      </Button>
    </>
  );
}
