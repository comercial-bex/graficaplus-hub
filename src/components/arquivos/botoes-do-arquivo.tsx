import { useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { abrirArquivo, baixarArquivo } from "@/lib/baixar-arquivo";
import { nomeParaBaixar, type ArquivoDaOs } from "@/domain/os/arquivos-da-os";
import { mensagemErro } from "@/lib/erros";

type Arquivo = Pick<ArquivoDaOs, "nome" | "caminho" | "bucket">;
type Variante = "default" | "outline" | "ghost" | "secondary";

/**
 * O botão "Baixar" de verdade (14/11/2026): o arquivo chega no computador com o
 * nome legível, de qualquer bucket, e a falha vira aviso — antes o "Baixar" da
 * OS abria uma aba e, se a assinatura falhasse, não acontecia nada.
 */
export function BotaoBaixar({
  arquivo,
  rotulo = "Baixar",
  variante = "outline",
  tamanho = "sm",
  className,
}: {
  arquivo: Arquivo;
  rotulo?: string;
  variante?: Variante;
  tamanho?: "sm" | "default";
  className?: string;
}) {
  const [baixando, setBaixando] = useState(false);
  async function baixar() {
    setBaixando(true);
    try {
      await baixarArquivo(arquivo);
    } catch (e) {
      toast.error(`Não foi possível baixar ${nomeParaBaixar(arquivo)}: ${mensagemErro(e, "o arquivo não respondeu")}`);
    } finally {
      setBaixando(false);
    }
  }
  return (
    <Button
      type="button"
      variant={variante}
      size={tamanho}
      className={className}
      disabled={baixando}
      onClick={() => void baixar()}
      aria-label={`${rotulo}: ${nomeParaBaixar(arquivo)}`}
    >
      <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
      {baixando ? "Baixando…" : rotulo}
    </Button>
  );
}

/** Abrir para ver numa aba nova (imagem e PDF o navegador mostra). */
export function BotaoAbrir({
  arquivo,
  rotulo = "Abrir",
  variante = "ghost",
}: {
  arquivo: Arquivo;
  rotulo?: string;
  variante?: Variante;
}) {
  const [abrindo, setAbrindo] = useState(false);
  async function abrir() {
    setAbrindo(true);
    try {
      await abrirArquivo(arquivo);
    } catch (e) {
      toast.error(`Não foi possível abrir ${nomeParaBaixar(arquivo)}: ${mensagemErro(e, "o arquivo não respondeu")}`);
    } finally {
      setAbrindo(false);
    }
  }
  return (
    <Button
      type="button"
      variant={variante}
      size="sm"
      disabled={abrindo}
      onClick={() => void abrir()}
      aria-label={`${rotulo}: ${nomeParaBaixar(arquivo)}`}
    >
      <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
      {abrindo ? "Abrindo…" : rotulo}
    </Button>
  );
}
