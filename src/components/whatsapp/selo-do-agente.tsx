import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { seloDoAgente } from "@/domain/agente/selo";
import { lerRegistroDoAgenteNaConversa } from "@/lib/api/agente-escolhe.functions";
import { SeloVisual } from "@/components/whatsapp/selo-da-triagem";

/** Prefixo de todas as leituras do selo do agente: invalidar este prefixo atualiza o cabeçalho. */
export const CHAVE_AGENTE_DA_CONVERSA = ["whatsapp", "agente-da-conversa"] as const;

/**
 * O selo "Agente" do cabeçalho da conversa aberta, no mesmo molde do selo da triagem (o desenho é o mesmo, `SeloVisual`).
 * Aparece só quando existe registro REAL do agente nesta conversa: resposta escolhida e colocada na fila, ou conversa entregue à
 * equipe. O evento `enviado` marca a fila, não a entrega ao contato, e o selo diz isso. Ensaio nunca enviou nada e não ganha selo; conversa que o agente nunca tocou não renderiza nada.
 *
 * A leitura vai pelo servidor (`lerRegistroDoAgenteNaConversa`, permissão whatsapp.read): o rastro do agente tem RLS para
 * quem gerencia o agente, e quem só atende a caixa leria zero e perderia o selo sem saber por quê. Erro de leitura esconde o
 * enfeite, mas a consulta fica em erro (a tela de métricas do agente é onde isso aparece de forma explícita). Migração do
 * agente ainda não aplicada: sem selo e sem erro. Só contagens chegam aqui; nenhum texto de mensagem.
 */
export function SeloDoAgente({
  conversaId,
  className,
}: {
  conversaId: string;
  className?: string;
}) {
  const ler = useServerFn(lerRegistroDoAgenteNaConversa);
  const { data } = useQuery({
    queryKey: [...CHAVE_AGENTE_DA_CONVERSA, conversaId],
    queryFn: () => ler({ data: { conversaId } }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const selo = seloDoAgente(data?.instalado ? data : null);
  if (!selo) return null;
  return <SeloVisual selo={selo} variante="cabecalho" className={className} />;
}
