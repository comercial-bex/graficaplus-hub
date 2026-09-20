import { useState } from "react";
import { Check, Copy, Share2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { PainelDoParceiro } from "@/domain/parceiros/painel";

/**
 * O link que o revendedor manda para outro revendedor.
 *
 * O laço é o do começo das redes sociais: cada parceiro tem um link só dele e
 * passa adiante. Quem entra por ele fica ligado a quem convidou, e é esse
 * vínculo que paga o bônus de indicação.
 *
 * O que este cartão mostra: quantos ele trouxe e quanto ganhou com isso.
 * O que ele NÃO mostra, de propósito: quem são e o que compraram. Mostrar a
 * compra de um parceiro para outro é expor dado de cliente de terceiro — e a
 * rede desenhada é informação da gráfica, não dele.
 */
export function ConviteCard({ painel }: { painel: PainelDoParceiro }) {
  const [copiado, setCopiado] = useState(false);
  const codigo = painel.parceiro.codigo_convite;

  if (!codigo) return null;

  const link = `${window.location.origin}/convite/${codigo}`;
  const texto =
    `Trabalho com a Bex Print como revendedor e tô te indicando. ` +
    `Preço de revenda, orçamento com a sua marca e crédito a cada compra. ` +
    `Cadastro por aqui: ${link}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      toast.success("Link copiado. É só colar no WhatsApp.");
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Navegador sem permissão de área de transferência: o link está na tela,
      // dá para selecionar à mão — melhor do que um erro que não ajuda.
      toast.error("Não consegui copiar. Selecione o link e copie à mão.");
    }
  }

  function compartilhar() {
    const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank", "noopener");
  }

  const { indicados, indicados_ativos, ganho_indicacao } = painel.parceiro;

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--bex-cyan)]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Indique outro revendedor</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Mande seu link. Quando quem você indicou comprar, uma parte volta em crédito para você.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">
          {link}
        </code>
        <Button variant="outline" size="sm" onClick={copiar}>
          {copiado ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
          {copiado ? "Copiado" : "Copiar"}
        </Button>
        <Button size="sm" onClick={compartilhar}>
          <Share2 className="mr-1 h-3.5 w-3.5" />
          WhatsApp
        </Button>
      </div>

      {indicados > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-sm">
          <span>
            <strong className="font-mono tabular-nums">{indicados}</strong>{" "}
            <span className="text-muted-foreground">
              {indicados === 1 ? "indicado" : "indicados"}
              {indicados_ativos !== indicados && ` · ${indicados_ativos} já liberado${indicados_ativos === 1 ? "" : "s"}`}
            </span>
          </span>
          <span>
            <strong className="font-mono tabular-nums text-[color:var(--bex-lime)]">
              {ganho_indicacao.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </strong>{" "}
            <span className="text-muted-foreground">ganhos em indicação</span>
          </span>
        </div>
      )}
    </div>
  );
}
