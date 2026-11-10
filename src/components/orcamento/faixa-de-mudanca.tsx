import { AlertTriangle } from "lucide-react";
import {
  FRASE_DE_FALHA_DA_FAIXA,
  frasesDaFaixa,
  orcamentoPedeConferirVersao,
  type DiferencaDaVersao,
} from "@/domain/orcamentos/o-que-mudou";

/**
 * A faixa "Mudou depois de enviado/aprovado" (10/11/2026). Antes era uma linha de 12 px em amarelo sem fundo
 * (contraste de 2,9 para 1 no tema claro) que, em 36 de 38 casos, só dizia "os itens mudaram sem mudar o
 * total". Agora é uma caixa com letra de 16 px na cor do texto (contraste de 12 para 1 no claro), diz o que o
 * cliente viu, o que mudou e o que fazer, e só aparece em orçamento enviado ou aprovado.
 *
 * O ícone usa a cor do texto: o amarelo sobre o fundo translúcido ficaria abaixo de 3 para 1.
 */
const CAIXA =
  "md:ml-12 flex gap-3 rounded-md border border-warning/60 bg-warning/15 p-3 text-base text-foreground";

export function FaixaDeMudanca({
  versao,
  statusDoOrcamento,
  erro,
}: {
  versao: DiferencaDaVersao | null | undefined;
  statusDoOrcamento: string | null | undefined;
  /** A consulta da versão falhou: avisa em vez de sumir. */
  erro?: unknown;
}) {
  if (erro && orcamentoPedeConferirVersao(statusDoOrcamento)) {
    return (
      <div role="alert" data-faixa-de-mudanca="falha" className={CAIXA}>
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />
        <p>{FRASE_DE_FALHA_DA_FAIXA}</p>
      </div>
    );
  }

  const frases = frasesDaFaixa(versao, statusDoOrcamento);
  if (!frases) return null;

  return (
    <div role="status" data-faixa-de-mudanca="mudou" className={CAIXA}>
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-semibold">{frases.titulo}</p>
        <p>{frases.valor}</p>
        {frases.oQueMudou.map((linha) => (
          <p key={linha}>{linha}</p>
        ))}
        <p>{frases.oQueFazer}</p>
      </div>
    </div>
  );
}
