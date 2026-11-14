import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { nomeSeguro } from "@/domain/portal/envio-de-arquivo";
import type { ArquivoDaOs } from "@/domain/os/arquivos-da-os";

/**
 * Anexar o arquivo direto da ficha do quadro (30/10/2026).
 *
 * Havia OS parada em "Sem arquivo final de produção" e OS concluída sem arte, e o
 * único caminho era abrir a OS completa. Aqui o arquivo sobe pelo mesmo caminho da
 * tela da OS (bucket `arquivos-clientes`, linha em `arquivos`, trilha em
 * `logs_auditoria`), e quem pode marcar o arquivo final já marca no mesmo gesto.
 * A marcação é conferida: a política de UPDATE barra em silêncio (0 linhas, sem
 * erro), e dizer "marcado" sem ter marcado é o defeito que o sistema já teve.
 *
 * Mockup × arquivo de impressão (14/11/2026): o botão diz O QUE está subindo.
 *   - "impressao": tipo `producao` e marcado como final de produção — é o que vai
 *     para a máquina. Mesmo nome de um arquivo de impressão que já existe = nova
 *     versão: a anterior fica como substituída (não some, sai da frente).
 *   - "mockup": tipo `arte` — o visual que o cliente vê e aprova. Não é marcado
 *     como final.
 * O nome no Storage passa por `nomeSeguro`: acento e símbolo no nome do arquivo
 * ("Fachada São José.pdf") faziam o Storage recusar com "Invalid key".
 */
export function AnexarArquivoRapido({
  osId,
  papel = "impressao",
  atuais = [],
  rotulo,
}: {
  osId: string;
  /** O que está subindo: o arquivo que vai para a máquina ou o mockup do cliente. */
  papel?: "impressao" | "mockup";
  /** Os arquivos de impressão vigentes: mesmo nome vira nova versão. */
  atuais?: ArquivoDaOs[];
  rotulo?: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const entrada = useRef<HTMLInputElement>(null);
  const enviandoRef = useRef(false);
  const [enviando, setEnviando] = useState(false);
  const deImpressao = papel === "impressao";

  async function enviar(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo || enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const anterior = deImpressao
        ? (atuais.find((a) => a.nome.trim().toLowerCase() === arquivo.name.trim().toLowerCase()) ?? null)
        : null;
      const caminho = `${osId}/${Date.now()}_${nomeSeguro(arquivo.name)}`;
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
          versao: (anterior?.versao ?? 0) + 1,
          tipo: deImpressao ? "producao" : "arte",
          os_item_id: anterior?.os_item_id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      await supabase.from("logs_auditoria").insert({
        entidade: "arquivos",
        entidade_id: novo?.id,
        acao: anterior ? "nova_versao" : "upload",
        detalhes: {
          os_id: osId,
          nome: arquivo.name,
          papel,
          origem: "ficha_do_quadro",
          substituido_id: anterior?.id ?? null,
        },
        usuario_id: user?.id,
      });

      let final = false;
      if (deImpressao && novo?.id) {
        const { data: marcado, error: marcaErr } = await (supabase as any)
          .from("arquivos")
          .update({ final_producao: true })
          .eq("id", novo.id)
          .select("id");
        final = !marcaErr && !!marcado && marcado.length > 0;
        // A versão anterior sai da frente — conferido, como a marcação.
        if (final && anterior) {
          await (supabase as any)
            .from("arquivos")
            .update({ status: "substituido", substituido_por: novo.id, ativo: false })
            .eq("id", anterior.id)
            .select("id");
        }
      }
      if (!deImpressao) toast.success("Mockup anexado.");
      else if (final)
        toast.success(anterior ? `Nova versão (v${(anterior.versao ?? 1) + 1}) anexada: é a que vai para a máquina.` : "Arquivo de impressão anexado: é o que vai para a máquina.");
      else toast.warning("Arquivo anexado, mas o seu perfil não pode marcá-lo como final de produção. Peça a quem pode.");

      void qc.invalidateQueries({ queryKey: ["kanban-os"] });
      void qc.invalidateQueries({ queryKey: ["kanban-bloqueios"] });
      void qc.invalidateQueries({ queryKey: ["arquivos-os", osId] });
      void qc.invalidateQueries({ queryKey: ["painel-producao"] });
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  const texto = rotulo ?? (deImpressao ? "Anexar arquivo de impressão" : "Anexar mockup");
  return (
    <>
      <input ref={entrada} type="file" className="hidden" onChange={enviar} aria-label={texto} />
      <Button type="button" size="sm" variant="outline" disabled={enviando} onClick={() => entrada.current?.click()}>
        <Paperclip className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {enviando ? "Enviando..." : texto}
      </Button>
    </>
  );
}
