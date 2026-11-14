import { interpretar } from "../whatsapp/triagem/quadro";
import { atrasoHumanizado } from "../whatsapp/triagem/textos";
import type { RespostaDoQuadro } from "../whatsapp/triagem/tipos";
import { verificarTexto, type RegraDoBanco } from "../whatsapp/triagem/verificador";
import { escolherResposta } from "./escolher";
import { portaoDoAgente } from "./portao";
import {
  TEMAS_QUE_PASSAM_PARA_A_EQUIPE,
  type ContextoDoAgente,
  type DecisaoDoAgente,
} from "./tipos";

/**
 * A decisão do agente para UMA mensagem do contato. Função pura, sem relógio nem rede.
 *
 * Só há cinco saídas: nada (silêncio), barrar, parar, entregar à equipe ou escolher uma resposta aprovada. Não existe
 * saída "escrever". O texto de `escolher` é o `texto_aprovado` da base, e antes de sair passa por `verificarTexto`
 * (a última porta, com os termos que o dono acrescentou no banco); o banco roda o validador próprio do agente de novo
 * em `agente_registrar`, sobre o texto que ELE leu. Reprovado em qualquer das duas: entrega à equipe com o motivo
 * `texto_reprovado` e os CÓDIGOS das regras, nunca o trecho.
 */

export function decidirDoAgente(
  ctx: ContextoDoAgente,
  quadro: readonly RespostaDoQuadro[],
  extras: readonly RegraDoBanco[] = [],
): DecisaoDoAgente {
  const portao = portaoDoAgente(ctx, quadro);
  if (portao.acao !== "abre") return portao;
  // o portão só abre com triagem e mensagem presentes
  const triagem = ctx.triagem!;
  const m = ctx.mensagem!;

  if (m.tipo === "sticker") return { acao: "barrar", motivo: "figurinha" };
  if (m.tipo !== "texto") {
    // áudio, imagem, documento, vídeo, localização, contato: o agente não lê, a equipe vê
    return { acao: "entregar", motivo: "nao_e_texto", ehPreco: false, regras: [] };
  }
  const pergunta = (m.texto ?? "").trim();
  if (!pergunta) return { acao: "barrar", motivo: "sem_texto" };

  const interp = interpretar(pergunta, null, quadro, { qualquerPasso: true });
  switch (interp.intencao) {
    case "parar":
      return { acao: "parar", motivo: "parar" };
    case "saudacao":
    case "agradecimento":
      // "obrigado" e "bom dia" não são pergunta: sem resposta e sem aviso à equipe
      return { acao: "barrar", motivo: "cortesia" };
    case "automatica":
      return { acao: "barrar", motivo: "robo" };
    case "reclamacao":
      return { acao: "entregar", motivo: "reclamou", ehPreco: false, regras: [] };
    default:
      break;
  }

  const escolha = escolherResposta(
    pergunta,
    ctx.base,
    { ramo: triagem.ramo, produtoId: null, familia: null },
    interp.intencao === "pergunta_preco",
  );

  // a segunda pergunta de preço da conversa vai à equipe, qualquer que seja a resposta
  if (escolha.ehPreco && ctx.perguntasDePreco >= 1) {
    return { acao: "entregar", motivo: "preco_de_novo", ehPreco: true, regras: [] };
  }
  if (escolha.tipo === "empate") {
    return { acao: "entregar", motivo: "empate", ehPreco: false, regras: [] };
  }
  if (escolha.tipo === "sem_resposta") {
    return {
      acao: "entregar",
      motivo: interp.intencao === "falar_com_equipe" ? "pediu_equipe" : "sem_resposta",
      ehPreco: escolha.ehPreco,
      regras: [],
    };
  }

  const r = escolha.casamento.resposta;
  const texto = r.texto_aprovado as string;
  const v = verificarTexto(texto, triagem.ramo, extras);
  if (!v.ok) {
    return {
      acao: "entregar",
      motivo: "texto_reprovado",
      ehPreco: escolha.ehPreco,
      regras: [...new Set(v.problemas.map((p) => p.regra))],
    };
  }
  return {
    acao: "escolher",
    respostaId: r.id,
    versao: r.versao,
    tema: r.tema,
    texto,
    especificidade: escolha.especificidade,
    candidatas: escolha.candidatas,
    ehPreco: escolha.ehPreco,
    passarParaEquipe:
      TEMAS_QUE_PASSAM_PARA_A_EQUIPE.includes(r.tema) || interp.intencao === "falar_com_equipe",
    atrasoS: atrasoHumanizado(
      ctx.conversaId,
      "agente",
      ctx.config.atrasoMinS,
      ctx.config.atrasoMaxS,
    ),
  };
}
