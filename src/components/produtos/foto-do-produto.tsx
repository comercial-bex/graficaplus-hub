import { useRef, useState } from "react";
import { Copy, ImagePlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import {
  fotoFoiGerada,
  gerarFotoDoProduto,
  mensagemDaFotoGerada,
  promptDaFotoDoProduto,
  type ProdutoParaFoto,
} from "@/lib/api/produtos-foto-ia.functions";

/**
 * Foto do produto no cadastro (24/10/2026). A tabela do parceiro mostra a foto
 * ao lado do preço; até aqui 0 de 45 produtos tinham foto e a tela nem tinha
 * onde pôr. Vai para o bucket público `produtos-fotos` (só admin e gerência
 * gravam) e o endereço fica em `produtos.imagem_url`.
 *
 * 01/11/2026: com `produto` informado, aparece "Gerar foto com IA" (a IA do
 * Lovable desenha o produto no padrão da Bex Print e já guarda no cadastro) e
 * "Copiar pedido" (o mesmo texto, para gerar fora quando a IA não estiver
 * ligada). A foto gerada é marcada como tal; a real, enviada aqui, a substitui.
 */
export const BUCKET_DE_FOTOS = "produtos-fotos";
const LIMITE_MB = 5;

export function FotoDoProduto({
  valor,
  onChange,
  produto,
}: {
  valor: string;
  onChange: (url: string) => void;
  /** Dados para a IA desenhar. Sem `id` (produto ainda não salvo) o botão fica desligado. */
  produto?: ProdutoParaFoto & { id?: string | null };
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [gerando, setGerando] = useState(false);

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

  async function gerar() {
    if (!produto?.id) return;
    setGerando(true);
    try {
      const r = await gerarFotoDoProduto({ data: { produtoId: produto.id } });
      if (r.estado === "ok") {
        onChange(r.url);
        toast.success("Foto gerada pela IA e guardada no produto. Quando tiver a foto real, envie por aqui que ela substitui.");
      } else {
        toast.error(mensagemDaFotoGerada(r));
      }
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível gerar a foto agora."));
    } finally {
      setGerando(false);
    }
  }

  async function copiarPedido() {
    if (!produto) return;
    try {
      await navigator.clipboard.writeText(promptDaFotoDoProduto(produto));
      toast.success("Pedido copiado. Cole no gerador de imagem e depois envie a foto por aqui.");
    } catch {
      toast.error("Não consegui copiar. Selecione o texto do pedido à mão.");
    }
  }

  const gerada = fotoFoiGerada(valor);
  const ocupado = enviando || gerando;

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/40">
        {valor ? (
          <img src={valor} alt="Foto do produto" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-6 w-6 text-muted-foreground" aria-hidden />
        )}
        {gerada && (
          <span className="absolute bottom-0 left-0 right-0 bg-foreground/80 px-1 py-0.5 text-center text-xs font-medium text-background">
            Gerada pela IA
          </span>
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
          <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={() => entrada.current?.click()}>
            {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1 h-3.5 w-3.5" />}
            {valor ? "Trocar foto" : "Enviar foto"}
          </Button>
          {produto && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={ocupado || !produto.id}
              onClick={() => void gerar()}
              data-testid="gerar-foto-com-ia"
            >
              {gerando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {gerada ? "Gerar outra com IA" : "Gerar foto com IA"}
            </Button>
          )}
          {produto && (
            <Button type="button" size="sm" variant="ghost" disabled={ocupado} onClick={() => void copiarPedido()}>
              <Copy className="mr-1 h-3.5 w-3.5" /> Copiar pedido
            </Button>
          )}
          {valor && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")} disabled={ocupado}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remover
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {produto && !produto.id
            ? "Salve o produto uma vez para a IA poder gerar a foto."
            : produto
              ? "A IA desenha o produto em fundo branco com a marca Bex Print. Foto real enviada por aqui substitui a gerada."
              : "Aparece na tabela do parceiro."}{" "}
          JPG, PNG ou WebP, até {LIMITE_MB} MB.
        </p>
      </div>
    </div>
  );
}
