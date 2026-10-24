import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";

/**
 * Foto do produto no cadastro (24/10/2026). A tabela do parceiro mostra a foto
 * ao lado do preço; até aqui 0 de 45 produtos tinham foto e a tela nem tinha
 * onde pôr. Vai para o bucket público `produtos-fotos` (só admin e gerência
 * gravam) e o endereço fica em `produtos.imagem_url`.
 */
export const BUCKET_DE_FOTOS = "produtos-fotos";
const LIMITE_MB = 5;

export function FotoDoProduto({ valor, onChange }: { valor: string; onChange: (url: string) => void }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(arquivo: File) {
    if (!arquivo.type.startsWith("image/")) return toast.error("Escolha uma imagem (JPG, PNG ou WebP).");
    if (arquivo.size > LIMITE_MB * 1024 * 1024) return toast.error(`A foto passa de ${LIMITE_MB} MB. Reduza e tente de novo.`);
    setEnviando(true);
    try {
      const extensao = (arquivo.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const caminho = `${crypto.randomUUID()}.${extensao}`;
      const { error } = await supabase.storage.from(BUCKET_DE_FOTOS).upload(caminho, arquivo, {
        cacheControl: "31536000",
        contentType: arquivo.type,
      });
      if (error) throw error;
      onChange(supabase.storage.from(BUCKET_DE_FOTOS).getPublicUrl(caminho).data.publicUrl);
      toast.success("Foto enviada. Salve o produto para guardar.");
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível enviar a foto. Só administrador e gerência enviam fotos de produto."));
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/40">
        {valor ? (
          <img src={valor} alt="Foto do produto" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-6 w-6 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="space-y-1.5">
        <input
          ref={entrada}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Escolher foto do produto"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void enviar(f);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={enviando} onClick={() => entrada.current?.click()}>
            {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1 h-3.5 w-3.5" />}
            {valor ? "Trocar foto" : "Enviar foto"}
          </Button>
          {valor && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")} disabled={enviando}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remover
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Aparece na tabela do parceiro. JPG, PNG ou WebP, até {LIMITE_MB} MB.</p>
      </div>
    </div>
  );
}
