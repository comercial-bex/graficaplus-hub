import {
  mandaMensagemDeVerdade,
  proximoDegrau,
  ROTULO_DO_DEGRAU,
  type Degrau,
} from "../whatsapp/triagem/escada";
import type { RamoDaBase, RespostaDaBase } from "../agente-base/tipos";
import { respostaServe } from "./escolher";
import { TEMA_DE_PRECO } from "./tipos";

/**
 * O painel do agente (C4): a escada de estados falada em palavras do dono, a conta das respostas aprovadas por ramo e o que
 * falta para subir um degrau. Funções puras: nada aqui fala com banco, rede ou WhatsApp.
 *
 * A escada é a mesma da triagem (desligada, ensaio, teste, parcial, ligada), um degrau por vez para subir. Quem decide de
 * verdade é o banco (`agente_config_salvar` e o gatilho da configuração); estas exigências existem para a tela falar claro
 * ANTES de o banco recusar, e uma delas é só do cuidado da tela: sem nenhuma resposta aprovada o agente passaria toda
 * pergunta à equipe, então a tela não deixa subir para um degrau em que ele fala de verdade.
 *
 * Texto de tela do dono: português simples, sem travessão, sem seta e sem parênteses.
 */

/** Quantas respostas aprovadas cada ramo deveria ter antes de o agente falar de verdade. Abaixo disso a tela avisa. */
export const MINIMO_DE_RESPOSTAS_POR_RAMO = 15;

export const RAMOS_DO_AGENTE: readonly RamoDaBase[] = ["cliente", "parceiro"] as const;

/** No degrau parcial a porcentagem vai até aqui. Para todos os contatos o degrau é ligada, que o dono sobe de propósito. */
export const PORCENTAGEM_MAXIMA_EM_PARCIAL = 50;

/** A frase de quando a porcentagem passa do limite do parcial. Serve à tela e ao servidor, para os dois dizerem a mesma coisa. */
export const AVISO_DA_PORCENTAGEM_MAXIMA =
  "Em parcial, a porcentagem vai só até 50. Para todos os contatos, suba para ligada.";

/** A frase de quando a chave antiga de texto livre depois da triagem está ligada. Serve à tela e ao servidor. */
export const AVISO_DA_CHAVE_ANTIGA =
  "A chave antiga de texto livre depois da triagem está ligada na configuração do robô de boas-vindas. Com ela ligada uma IA pode escrever o que quiser, e o dono não quer isso. Desligue essa chave antes de subir o agente.";

export function ramoDoAgenteEmTexto(ramo: RamoDaBase): string {
  return ramo === "parceiro" ? "Parceiro" : "Cliente final";
}

export type CoberturaDoRamo = {
  ramo: RamoDaBase;
  /** Respostas que o agente PODE mandar neste ramo: aprovadas, com o texto aprovado igual ao texto atual. */
  aprovadas: number;
  /** Rascunhos deste ramo que esperam aprovação. */
  rascunhos: number;
  minimo: number;
  faltam: number;
  /** Existe a resposta aprovada de que a equipe confirma o valor. Sem ela toda pergunta de preço vai à equipe. */
  temRespostaDePreco: boolean;
  completo: boolean;
};

export type CoberturaDaBase = {
  porRamo: CoberturaDoRamo[];
  /** Respostas aprovadas, sem contar duas vezes a que serve aos dois ramos. */
  aprovadasNoTotal: number;
  rascunhosNoTotal: number;
  /** Algum ramo abaixo do mínimo. */
  algumRamoAbaixo: boolean;
};

type RespostaParaConta = Pick<
  RespostaDaBase,
  "status" | "ramos" | "tema" | "texto_aprovado" | "resposta"
>;

export function coberturaDaBase(respostas: readonly RespostaParaConta[]): CoberturaDaBase {
  const servem = respostas.filter((r) => respostaServe(r as RespostaDaBase));
  const rascunhos = respostas.filter((r) => r.status === "rascunho");
  const porRamo = RAMOS_DO_AGENTE.map((ramo): CoberturaDoRamo => {
    const doRamo = servem.filter((r) => r.ramos.includes(ramo));
    const aprovadas = doRamo.length;
    return {
      ramo,
      aprovadas,
      rascunhos: rascunhos.filter((r) => r.ramos.includes(ramo)).length,
      minimo: MINIMO_DE_RESPOSTAS_POR_RAMO,
      faltam: Math.max(0, MINIMO_DE_RESPOSTAS_POR_RAMO - aprovadas),
      temRespostaDePreco: doRamo.some((r) => r.tema === TEMA_DE_PRECO),
      completo: aprovadas >= MINIMO_DE_RESPOSTAS_POR_RAMO,
    };
  });
  return {
    porRamo,
    aprovadasNoTotal: servem.length,
    rascunhosNoTotal: rascunhos.length,
    algumRamoAbaixo: porRamo.some((r) => !r.completo),
  };
}

/** "Cliente final: 3 de 15 aprovadas." Sempre com o total, nunca o número solto. */
export function contadorDoRamo(c: CoberturaDoRamo): string {
  return `${ramoDoAgenteEmTexto(c.ramo)}: ${c.aprovadas} de ${c.minimo} aprovadas`;
}

/**
 * O aviso que fica à vista enquanto algum ramo tem menos respostas aprovadas que o mínimo. Devolve uma frase por ramo
 * abaixo do mínimo, com o que isso causa. Lista vazia quando todos os ramos estão completos.
 */
export function avisosDaBase(cobertura: CoberturaDaBase): string[] {
  const avisos: string[] = [];
  for (const c of cobertura.porRamo) {
    if (c.completo) continue;
    const nome = ramoDoAgenteEmTexto(c.ramo);
    if (c.aprovadas === 0) {
      avisos.push(
        `${nome} não tem nenhuma resposta aprovada. O agente passaria toda pergunta deste ramo para a equipe. São ${c.minimo} no mínimo.`,
      );
    } else {
      avisos.push(
        `${nome} tem só ${c.aprovadas} de ${c.minimo} respostas aprovadas. Faltam ${c.faltam}. Pergunta sem resposta aprovada vai para a equipe.`,
      );
    }
  }
  for (const c of cobertura.porRamo) {
    if (c.aprovadas > 0 && !c.temRespostaDePreco) {
      avisos.push(
        `${ramoDoAgenteEmTexto(c.ramo)} não tem a resposta aprovada de que a equipe confirma o valor. Toda pergunta de preço deste ramo vai para a equipe sem resposta.`,
      );
    }
  }
  return avisos;
}

/** O que cada degrau faz, para o agente. Mesmos degraus da triagem, outras palavras. */
export const EXPLICACAO_DO_DEGRAU_DO_AGENTE: Record<Degrau, string> = {
  desligada: "O agente não faz nada. Toda pergunta depois da triagem segue só com a equipe.",
  ensaio:
    "O agente lê as perguntas e anota qual resposta aprovada mandaria, ou se passaria para a equipe, mas não manda mensagem nenhuma. Serve para medir quantas perguntas a base cobre.",
  teste:
    "O agente responde de verdade, mas só para os números de teste da lista. Ninguém mais recebe resposta do agente.",
  parcial:
    "O agente responde de verdade para os números de teste e para uma parte dos contatos, na porcentagem escolhida.",
  ligada:
    "O agente responde de verdade para todo contato que fez a triagem e continua perguntando.",
};

export function avisoDeConfirmacaoDoAgente(para: Degrau, percentual: number): string | null {
  if (para === "teste")
    return "A partir de agora o agente vai responder de verdade, mas só para os números de teste da lista.";
  if (para === "parcial")
    return `A partir de agora o agente vai responder de verdade para os números de teste e para cerca de ${percentual} de cada 100 contatos.`;
  if (para === "ligada")
    return "A partir de agora o agente vai responder de verdade para todo contato que continuar perguntando depois da triagem.";
  return null;
}

/** Subir a porcentagem em parcial muda quem recebe resposta de verdade: a tela confirma. Diminuir não pede confirmação. */
export function confirmacaoDeAumentarAPorcentagem(
  estado: Degrau,
  de: number,
  para: number,
): string | null {
  if (estado !== "parcial" || para <= de) return null;
  return `Com o agente em parcial, a porcentagem vai de ${de} para ${para}. A partir de agora cerca de ${para} de cada 100 contatos recebem resposta do agente de verdade.`;
}

/** A porcentagem cabe no degrau? Em parcial vai até 50; fora do parcial só vale de 0 a 100. */
export function porcentagemCabeNoDegrau(estado: Degrau, n: number): boolean {
  if (!Number.isInteger(n) || n < 0 || n > 100) return false;
  return estado !== "parcial" || n <= PORCENTAGEM_MAXIMA_EM_PARCIAL;
}

export type SituacaoDoAgenteParaSubir = {
  atual: Degrau;
  percentual: number;
  numerosDeTeste: readonly string[];
  cobertura: CoberturaDaBase;
  /** `whatsapp_triagem_config.agente_apos_triagem` está ligada: a assistente de texto livre voltaria a falar. Bloqueia qualquer subida. */
  chaveAntigaLigada?: boolean;
};

export type PodeSubirOAgente =
  | { pode: true; para: Degrau; avisos: string[] }
  | { pode: false; para: Degrau | null; motivo: string };

/**
 * O que falta para subir um degrau. O banco confere de novo o que é dele (um degrau por vez e a permissão); o que é só da
 * tela: ensaio pode subir mesmo com a base vazia, porque é o ensaio que mostra o que falta escrever; teste, parcial e ligada
 * pedem ao menos uma resposta aprovada, teste pede número de teste e parcial pede porcentagem.
 */
export function podeSubirOAgente(s: SituacaoDoAgenteParaSubir): PodeSubirOAgente {
  const para = proximoDegrau(s.atual);
  if (!para) return { pode: false, para: null, motivo: "O agente já está no último degrau." };
  if (s.chaveAntigaLigada) return { pode: false, para, motivo: AVISO_DA_CHAVE_ANTIGA };
  if (mandaMensagemDeVerdade(para) && s.cobertura.aprovadasNoTotal === 0) {
    return {
      pode: false,
      para,
      motivo:
        "Nenhuma resposta está aprovada. Aprove ao menos uma na tela Respostas do agente antes de subir, senão o agente passaria toda pergunta para a equipe.",
    };
  }
  if (para === "teste" && s.numerosDeTeste.length === 0) {
    return {
      pode: false,
      para,
      motivo:
        "Cadastre pelo menos um número de teste antes de subir. Sem ele, ninguém receberia a resposta de teste.",
    };
  }
  if (para === "parcial" && s.percentual < 1) {
    return {
      pode: false,
      para,
      motivo: "Escolha uma porcentagem acima de zero antes de subir para parcial.",
    };
  }
  if (para === "parcial" && s.percentual > PORCENTAGEM_MAXIMA_EM_PARCIAL) {
    return { pode: false, para, motivo: AVISO_DA_PORCENTAGEM_MAXIMA };
  }
  const avisos = mandaMensagemDeVerdade(para) ? avisosDaBase(s.cobertura) : [];
  return { pode: true, para, avisos };
}

/** Frase do botão grande, no degrau atual. */
export function textoDoBotaoDeSubirOAgente(atual: Degrau): string {
  const para = proximoDegrau(atual);
  if (!para) return "Já está no último degrau";
  return `Subir para ${ROTULO_DO_DEGRAU[para].toLowerCase()}`;
}

/** Por que o agente está desligado, em palavras. Os códigos são os de `agente_desligar` e dos freios do banco. */
export function motivoDeDesligarOAgente(codigo: string | null | undefined): string {
  switch (codigo) {
    case null:
    case undefined:
    case "":
      return "Ainda não foi ligado.";
    case "botao_desligar_tudo":
      return "Desligado pelo botão Desligar tudo.";
    case "freio_falhas_de_envio":
      return "Desligou sozinho: houve falhas seguidas no envio.";
    case "freio_erros_de_leitura":
      return "Desligou sozinho: houve erros demais ao ler as conversas.";
    default:
      return `Desligado. Motivo: ${codigo.replace(/_/g, " ")}.`;
  }
}
