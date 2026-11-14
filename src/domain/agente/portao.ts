import { triagemPodeFalarCom } from "../whatsapp/triagem/extrair";
import { detectarRobo } from "../whatsapp/triagem/portao";
import { interpretar } from "../whatsapp/triagem/quadro";
import { entraNoSorteio } from "../whatsapp/triagem/textos";
import type { RespostaDoQuadro } from "../whatsapp/triagem/tipos";
import type { ConfigDoAgente, ContextoDoAgente, DecisaoDoAgente, ModoDoAgente } from "./tipos";

/**
 * O portão do agente: quem pode falar, e se pode falar agora. Função pura; o banco confere de novo os pontos que
 * importam (`agente_registrar`), porque entre ler e enfileirar a equipe pode ter entrado na conversa.
 *
 * A ORDEM IMPORTA, e tem uma razão em cada degrau:
 *  1. o que não é do agente fica em SILÊNCIO, sem evento (desligada, triagem sem terminar, mensagem da própria triagem,
 *     degrau que não cobre a conversa e, no envio real, qualquer conversa de que o agente não é o dono: com gente da equipe
 *     ou bloqueada, o dono já é outro e o agente não chama o banco nem grava nada). Um evento por mensagem de cada conversa
 *     que o agente não atende encheria a tabela de ruído, e o degrau parcial gravaria 9 em cada 10 conversas. No ENSAIO ninguém
 *     é dono, então gente na conversa e bloqueio deixam o evento `barrado`, que é o que o ensaio mede;
 *  2. daí em diante o agente É o dono da conversa (ou está ensaiando), e cada recusa deixa um evento `barrado` com o motivo:
 *     número que o robô não alcança e robô de empresa;
 *  3. o PEDIDO DE PARAR vem antes de tudo o que segue (robô, teto, freio de volume, resposta ainda na fila): quem pede para parar
 *     tem de ser bloqueado e ter a resposta pendente cancelada mesmo que o agente já tenha batido no teto ou no freio;
 *  4. teto de mensagens, freio de volume e rajada (resposta anterior ainda na fila) NÃO são silêncio: a conversa passa à
 *     equipe (`entregar`), porque o contato ficaria sem resposta e sem ninguém sabendo. O aviso ao grupo já deduplica por conversa.
 */

export type ResultadoDoPortao =
  | { acao: "abre"; modo: ModoDoAgente }
  | Exclude<DecisaoDoAgente, { acao: "escolher" }>;

/** O número da conversa é de teste? Os dois lados só com dígitos; o banco guarda com 55. */
export function ehNumeroDeTeste(
  telefoneNormalizado: string | null,
  numeros: readonly string[],
): boolean {
  if (!telefoneNormalizado) return false;
  const d = telefoneNormalizado.replace(/\D/g, "");
  return numeros.some((n) => n.replace(/\D/g, "") === d);
}

/**
 * O degrau cobre esta conversa? Espelho de `_agente_degrau_permite` (banco), com uma diferença de propósito: o ensaio
 * cobre todas as conversas (anota, não envia), enquanto no banco o ensaio nunca é "envio real".
 */
export function degrauCobre(
  config: Pick<ConfigDoAgente, "estado" | "percentual" | "numerosDeTeste">,
  conversaId: string,
  telefoneNormalizado: string | null,
): boolean {
  switch (config.estado) {
    case "desligada":
      return false;
    case "ensaio":
    case "ligada":
      return true;
    case "teste":
      return ehNumeroDeTeste(telefoneNormalizado, config.numerosDeTeste);
    case "parcial":
      return (
        ehNumeroDeTeste(telefoneNormalizado, config.numerosDeTeste) ||
        entraNoSorteio(conversaId, config.percentual)
      );
  }
}

export function portaoDoAgente(
  ctx: ContextoDoAgente,
  quadro: readonly RespostaDoQuadro[],
): ResultadoDoPortao {
  const nada = (
    motivo: Extract<ResultadoDoPortao, { acao: "nada" }>["motivo"],
  ): ResultadoDoPortao => ({
    acao: "nada",
    motivo,
  });
  const barra = (
    motivo: Extract<ResultadoDoPortao, { acao: "barrar" }>["motivo"],
  ): ResultadoDoPortao => ({
    acao: "barrar",
    motivo,
  });
  const cfg = ctx.config;

  if (cfg.estado === "desligada") return nada("desligada");
  if (!ctx.triagem || !ctx.triagem.liberou) return nada("sem_triagem_liberada");
  const m = ctx.mensagem;
  if (!m) return nada("mensagem_inexistente");
  if (!m.posteriorATriagem) return nada("mensagem_da_triagem");
  if (m.origem === "automacao" || m.tipo === "sistema") return nada("nao_e_pessoa");
  if (ctx.jaDecidida) return nada("ja_decidida");
  if (ctx.ehDeGrupo) return nada("grupo");
  if (!degrauCobre(cfg, ctx.conversaId, ctx.telefoneNormalizado)) return nada("fora_do_degrau");

  const modo: ModoDoAgente = cfg.estado === "ensaio" ? "ensaio" : "real";
  // no envio real o dono da conversa é o agente (a mesma fonte da assistente): se não é, é porque a equipe entrou, o contato
  // foi bloqueado ou outro dono assumiu, e o agente fica em silêncio SEM chamar o banco e sem evento. No ensaio ninguém é dono,
  // só se anota, e as duas recusas abaixo deixam o evento `barrado`.
  if (modo === "real" && ctx.dono !== "agente") return nada("dono_nao_e_o_agente");

  if (ctx.humanoNaConversa) return barra("humano_na_conversa");
  if (ctx.bloqueado) return barra("bloqueado");
  if (!triagemPodeFalarCom(ctx.telefone)) return barra("sem_numero_alcancavel");

  // PARAR vem antes de robô, teto, freio de volume e resposta em andamento: o banco grava o bloqueio e cancela o que está na fila
  if (m.tipo === "texto" && (m.texto ?? "").trim()) {
    const interp = interpretar((m.texto ?? "").trim(), null, quadro, { qualquerPasso: true });
    if (interp.intencao === "parar") return { acao: "parar", motivo: "parar" };
  }

  const robo = detectarRobo({
    texto: m.texto ?? m.legenda,
    origem: m.origem,
    quadro,
    msDesdeNossoEnvio: ctx.msDesdeUltimaAutomatica,
  });
  if (robo.suspeito) {
    // pessoa que escreve muito ou manda link quer que alguém LEIA: vai à equipe, não ao silêncio
    if (robo.motivo === "texto_longo" || robo.motivo === "link") {
      return { acao: "entregar", motivo: robo.motivo, ehPreco: false, regras: [] };
    }
    return barra("robo");
  }

  if (ctx.enviadas >= cfg.maxMensagens) {
    return { acao: "entregar", motivo: "teto_de_mensagens", ehPreco: false, regras: [] };
  }
  if (ctx.enviadasNaHora >= cfg.maxPorHora || ctx.enviadasNoDia >= cfg.maxPorDia) {
    return { acao: "entregar", motivo: "freio_de_volume", ehPreco: false, regras: [] };
  }
  if (ctx.envioPendente) {
    return { acao: "entregar", motivo: "rajada", ehPreco: false, regras: [] };
  }
  return { acao: "abre", modo };
}
