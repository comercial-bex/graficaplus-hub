import { useAuth } from "@/lib/auth-context";
import type { ConversaDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import { oQueDaPraFazer, type DialogoDaConversa } from "@/domain/whatsapp/acoes-de-trabalho";
import { useMensagens } from "@/components/whatsapp/usar-caixa-de-entrada";
import {
  CriarOrcamentoDaConversa,
  CriarOsDaConversa,
} from "@/components/whatsapp/criar-a-partir-da-conversa";
import { VincularCliente } from "@/components/whatsapp/vincular-cliente";

/**
 * Os diálogos de trabalho da conversa, desenhados UMA vez pela moldura
 * (whatsapp.tsx) sempre que há conversa aberta: criar orçamento, criar OS e
 * vincular a um cliente. Dono: GAVETA (onda 1, 12/11/2026).
 *
 * Abrem de três lugares, todos pelo mesmo `onQual` que a moldura passa: o
 * cabeçalho da conversa (botão Orçamento e menu de três pontos), o [+] da
 * caixa de resposta e os botões da gaveta. Ficar montado com a conversa (e não
 * nascer no clique) é o que faz a lista de rascunhos chegar antes do primeiro
 * "Criar orçamento" (21/10/2026: #102 e #103 vazios com 29 s de diferença).
 *
 * Cada diálogo só é desenhado se a pessoa pode (a mesma regra da tela:
 * `oQueDaPraFazer`). O botão que abre já mostra o motivo quando não pode; esta
 * checagem é a segunda porta, para um estado de abertura que sobrou de antes de
 * a permissão mudar nunca abrir o que a pessoa não pode fazer.
 */
export type PropsDosDialogos = {
  conversa: ConversaDaCaixa;
  /** O diálogo aberto; null = nenhum. */
  qual: DialogoDaConversa | null;
  onQual: (qual: DialogoDaConversa | null) => void;
};

export function DialogosDaConversa({ conversa, qual, onQual }: PropsDosDialogos) {
  const { hasPermission } = useAuth();
  // Mesma consulta da gaveta e da conversa (cache compartilhado): o pedido do
  // cliente que entra no briefing vem daqui.
  const mensagens = useMensagens(conversa.id);
  const pode = oQueDaPraFazer({
    podeResponder: hasPermission("whatsapp.reply"),
    podeOrcar: hasPermission("orcamentos.create"),
    podeAbrirOs: hasPermission("os.create"),
    clienteId: conversa.cliente_id,
  });
  const lista = mensagens.data ?? [];
  const fechar = (v: boolean) => {
    if (!v) onQual(null);
  };
  return (
    <>
      {pode.orcamento.pode && (
        <CriarOrcamentoDaConversa
          conversa={conversa}
          mensagens={lista}
          aberto={qual === "orcamento"}
          onAberto={fechar}
        />
      )}
      {pode.os.pode && conversa.cliente_id && (
        <CriarOsDaConversa
          conversa={{ ...conversa, cliente_id: conversa.cliente_id }}
          mensagens={lista}
          aberto={qual === "os"}
          onAberto={fechar}
        />
      )}
      {pode.vincular_cliente.pode && (
        <VincularCliente
          conversa={conversa}
          aberto={qual === "vincular_cliente"}
          onAberto={fechar}
        />
      )}
    </>
  );
}
