import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { CONFERIR_A_CADA_MS, deveChamarAgora } from "@/domain/whatsapp/despachante";
import { acionarEnvio } from "@/components/whatsapp/usar-caixa-de-entrada";

/**
 * O despachante dos avisos ao cliente — sem tela, montado no layout logado.
 *
 * Os avisos automáticos (`notificacoes_fila`: orçamento aprovado, arte para
 * aprovar, em produção, pronto para retirar, saiu para entrega, concluído)
 * nascem dos gatilhos do banco e não tinham quem os mandasse: sem `pg_cron` e
 * sem `pg_net`, nada no servidor acorda sozinho. Desde 02/10/2026, com o
 * WhatsApp conectado, o dono decidiu que saem na hora — e quem leva é o
 * sistema aberto na tela de quem atende.
 *
 * Para quem tem `whatsapp.reply`: chama POST /api/whatsapp/enviar logo ao
 * montar e depois a cada 2 minutos, só com a aba visível, uma chamada por vez.
 * O consumidor reserva cada linha antes de mandar, então várias abas e várias
 * pessoas ao mesmo tempo não repetem aviso.
 *
 * SEM BARULHO: nada de toast, nada de tela vermelha. Rede fora, sessão
 * vencida, 401 ou 503 (WhatsApp desconectado) só vão para o console.debug, e
 * a próxima rodada tenta de novo. Quem precisa saber que o WhatsApp caiu é
 * avisado pela faixa do topo (AlertaWhatsapp) e pelo /avisos — não por um
 * erro piscando na tela de quem estava fazendo outra coisa.
 */
export function DespachanteDeAvisos() {
  const { user, hasPermission } = useAuth();
  const temPermissao = !!user && hasPermission("whatsapp.reply");
  const emAndamento = useRef(false);
  const ultimaChamadaEm = useRef<number | null>(null);

  useEffect(() => {
    if (!temPermissao) return;
    let montado = true;

    async function talvezChamar() {
      const agora = Date.now();
      const chamar = deveChamarAgora({
        temPermissao,
        abaVisivel: document.visibilityState === "visible",
        emAndamento: emAndamento.current,
        ultimaChamadaEm: ultimaChamadaEm.current,
        agora,
      });
      if (!chamar) return;
      emAndamento.current = true;
      ultimaChamadaEm.current = agora;
      try {
        const resultado = await acionarEnvio();
        if (montado) console.debug("[despachante de avisos]", resultado);
      } catch (e) {
        // acionarEnvio não lança; isto é só a rede de segurança do silêncio.
        console.debug("[despachante de avisos] falhou", e);
      } finally {
        emAndamento.current = false;
      }
    }

    void talvezChamar();
    const relogio = window.setInterval(() => void talvezChamar(), CONFERIR_A_CADA_MS);
    // Voltou para a aba depois de um tempo: chama já, se o intervalo venceu.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void talvezChamar();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      montado = false;
      window.clearInterval(relogio);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [temPermissao]);

  return null;
}
