import { Link } from "@tanstack/react-router";
import { ArrowRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AbaDaPasta } from "@/domain/catalogo/pasta-do-produto";
import type { OndeCorrigir as OndeCorrigirDados } from "@/domain/precos/onde-corrigir";

/**
 * "Vá até tal seção, tal módulo" e o botão que leva até lá (21/11/2026).
 *
 * Toda pendência do custeio mostra este quadro embaixo da frase: a frase em destaque diz onde se corrige, a linha
 * menor diz o que fazer, e o botão leva a pessoa até o lugar. Dentro da pasta do produto o botão não recarrega
 * nada: troca de aba, rola e destaca o campo (`aoIrParaCampo`). Fora dela (ficha da Tabela de preços, painel de
 * avisos) vira link, que abre a pasta, a Planilha de custos ou o outro módulo já no lugar certo.
 *
 * O destino de cada pendência mora em `src/domain/precos/onde-corrigir.ts`; este arquivo só desenha.
 */
export function OndeCorrigir({
  onde,
  produtoId,
  aoIrParaCampo,
  className,
  letraGrande = false,
}: {
  onde: OndeCorrigirDados;
  /** Sem o id, o botão que abre a pasta não aparece (a frase continua dizendo onde ir). */
  produtoId?: string;
  /** Dentro da pasta: troca de aba e destaca o campo em vez de navegar. */
  aoIrParaCampo?: (aba: AbaDaPasta, campo: string) => void;
  className?: string;
  /** Preços por produto não tem letra menor que 16 px: a linha do "o que fazer" sobe de text-sm para text-base. */
  letraGrande?: boolean;
}) {
  return (
    <div
      data-testid="onde-corrigir"
      className={cn("mt-1.5 rounded-md border border-l-4 border-primary/40 border-l-primary bg-primary/5 p-3", className)}
    >
      <p className="flex items-start gap-1.5 text-base font-semibold text-foreground">
        <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-link" aria-hidden="true" />
        <span>{onde.vaAte}</span>
      </p>
      <p className={cn("mt-1 text-muted-foreground", letraGrande ? "text-base" : "text-sm")}>{onde.fazer}</p>
      <BotaoDaCorrecao onde={onde} produtoId={produtoId} aoIrParaCampo={aoIrParaCampo} />
    </div>
  );
}

const CLASSE_DO_BOTAO = "mt-2 min-h-11 gap-1.5 text-base";

function BotaoDaCorrecao({
  onde,
  produtoId,
  aoIrParaCampo,
}: {
  onde: OndeCorrigirDados;
  produtoId?: string;
  aoIrParaCampo?: (aba: AbaDaPasta, campo: string) => void;
}) {
  const { alvo, botao } = onde;
  const conteudo = (
    <>
      {botao}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </>
  );
  if (alvo.tipo === "aqui") return null;

  if (alvo.tipo === "pasta") {
    if (aoIrParaCampo) {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={CLASSE_DO_BOTAO}
          data-testid="onde-corrigir-botao"
          onClick={() => aoIrParaCampo(alvo.aba, alvo.campo)}
        >
          {conteudo}
        </Button>
      );
    }
    if (!produtoId) return null;
    return (
      <Button asChild size="sm" variant="outline" className={CLASSE_DO_BOTAO} data-testid="onde-corrigir-botao">
        <Link to="/produtos/$id" params={{ id: produtoId }} search={{ aba: alvo.aba, campo: alvo.campo }}>
          {conteudo}
        </Link>
      </Button>
    );
  }

  if (alvo.tipo === "planilha") {
    return (
      <Button asChild size="sm" variant="outline" className={CLASSE_DO_BOTAO} data-testid="onde-corrigir-botao">
        <Link to="/planilha-custos" search={{ aba: alvo.aba }}>
          {conteudo}
        </Link>
      </Button>
    );
  }

  // Um Link por rota: o tipo do `to` é cada caminho, e não a união deles.
  return (
    <Button asChild size="sm" variant="outline" className={CLASSE_DO_BOTAO} data-testid="onde-corrigir-botao">
      {alvo.rota === "/materiais" ? (
        <Link to="/materiais">{conteudo}</Link>
      ) : alvo.rota === "/maquinas" ? (
        <Link to="/maquinas">{conteudo}</Link>
      ) : (
        <Link to="/custos-producao">{conteudo}</Link>
      )}
    </Button>
  );
}
