import type { RespostaDaBase } from "../../src/domain/agente-base/tipos";
import { CONFIG_PADRAO_DO_AGENTE, type ContextoDoAgente } from "../../src/domain/agente";
import { SEMENTES_DO_QUADRO } from "../../src/domain/whatsapp/triagem";

/** Construtores dos testes do agente. Nada aqui fala com banco. */

export const QUADRO = SEMENTES_DO_QUADRO;

let n = 0;
/** Uma resposta APROVADA, com `texto_aprovado` igual à `resposta`. */
export function resposta(
  p: Partial<RespostaDaBase> & { frases_gatilho: string[] },
): RespostaDaBase {
  n += 1;
  const texto = p.texto_aprovado ?? p.resposta ?? `Isso a equipe confirma, resposta ${n}.`;
  return {
    id: `r-${n}`,
    tema: `tema_${n}`,
    pergunta: `Pergunta ${n}`,
    ramos: ["cliente"],
    produto_id: null,
    familia: null,
    status: "aprovada",
    versao: 1,
    aprovada_por: null,
    aprovada_em: null,
    origem: "dono",
    contagem_ocorrencias: 0,
    atualizado_em: "",
    ...p,
    resposta: texto,
    texto_aprovado: texto,
  };
}

export const TEXTO_DO_VALOR =
  "Cada trabalho tem medida, material e quantidade próprios, então quem confirma o valor é a equipe. Me conte o produto, a medida e a quantidade que eu deixo anotado para ela.";
export const TEXTO_DO_HORARIO =
  "A equipe atende de segunda a sexta. Fora desse horário, deixe sua mensagem por aqui que a equipe vê quando abrir.";
export const TEXTO_DA_EQUIPE =
  "Tudo bem, vou avisar a equipe que você quer falar com uma pessoa. Ela responde por aqui assim que puder.";
export const TEXTO_DA_MEDIDA =
  "Me diga a largura e a altura que você precisa. A equipe confere se aquela medida é possível para o produto.";

export function basePadrao(): RespostaDaBase[] {
  return [
    resposta({
      id: "valor",
      tema: "valor_do_produto",
      texto_aprovado: TEXTO_DO_VALOR,
      frases_gatilho: ["quanto custa", "qual o valor", "preco", "valor"],
      versao: 2,
    }),
    resposta({
      id: "horario",
      tema: "horario_de_atendimento",
      texto_aprovado: TEXTO_DO_HORARIO,
      frases_gatilho: ["horario", "que horas abre"],
      versao: 3,
    }),
    resposta({
      id: "equipe",
      tema: "falar_com_a_equipe",
      texto_aprovado: TEXTO_DA_EQUIPE,
      frases_gatilho: ["falar com atendente", "falar com uma pessoa"],
    }),
    resposta({
      id: "medida",
      tema: "medida_do_produto",
      texto_aprovado: TEXTO_DA_MEDIDA,
      frases_gatilho: ["qual medida", "que medida"],
    }),
  ];
}

/** Um contexto em que o agente é dono e pode falar: degrau ligada, triagem concluída, celular brasileiro, nada pendente. */
export function contexto(
  p: Partial<ContextoDoAgente> & { texto?: string | null } = {},
): ContextoDoAgente {
  const { texto, ...resto } = p;
  return {
    config: { ...CONFIG_PADRAO_DO_AGENTE, estado: "ligada", valeAPartirDe: 1 },
    conversaId: "11111111-2222-4333-8444-555555555555",
    telefone: "5596999990001",
    telefoneNormalizado: "96999990001",
    ehDeGrupo: false,
    humanoNaConversa: false,
    bloqueado: false,
    dono: "agente",
    triagem: { id: "t-1", ramo: "cliente", liberou: true },
    mensagem: {
      id: "m-1",
      tipo: "texto",
      texto: texto === undefined ? "qual o horario?" : texto,
      legenda: null,
      origem: "humano",
      posteriorATriagem: true,
    },
    jaDecidida: false,
    enviadas: 0,
    enviadasNaHora: 0,
    enviadasNoDia: 0,
    perguntasDePreco: 0,
    envioPendente: false,
    msDesdeUltimaAutomatica: null,
    base: basePadrao(),
    ...resto,
  };
}

/** prng com semente fixa (mulberry32), como nos outros testes de propriedade. */
export function prng(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
