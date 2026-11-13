/**
 * A escada de ligar a triagem (plano da seção 8), para a tela de configuração.
 *
 *   desligada, ensaio, teste, parcial, ligada
 *
 * Sobe um degrau por vez, desce sempre. O banco confere a mesma regra
 * (`triagem_config_salvar` e o gatilho da configuração), então isto aqui existe
 * para a tela falar claro ANTES de o banco recusar, e para o botão grande saber
 * qual é o próximo passo. Os textos seguem o estilo do dono: português simples,
 * sem travessão, sem seta e sem parênteses.
 */

export const DEGRAUS = ["desligada", "ensaio", "teste", "parcial", "ligada"] as const;
export type Degrau = (typeof DEGRAUS)[number];

export const ROTULO_DO_DEGRAU: Record<Degrau, string> = {
  desligada: "Desligada",
  ensaio: "Ensaio",
  teste: "Teste",
  parcial: "Parcial",
  ligada: "Ligada",
};

/** O que cada degrau faz, em palavras que o dono usa. */
export const EXPLICACAO_DO_DEGRAU: Record<Degrau, string> = {
  desligada: "O robô de boas-vindas não faz nada. Todas as conversas seguem só com a equipe.",
  ensaio:
    "O robô lê as conversas novas e anota o que responderia, mas não manda mensagem nenhuma. Serve para conferir o que ele entende.",
  teste:
    "O robô responde de verdade, mas só para os números de teste da lista. Ninguém mais recebe mensagem automática.",
  parcial:
    "O robô responde de verdade para os números de teste e para uma parte dos contatos novos, na porcentagem escolhida.",
  ligada: "O robô responde de verdade para todo contato novo que escreve primeiro.",
};

/** Os degraus em que o robô manda mensagem de verdade para alguém. */
export function mandaMensagemDeVerdade(d: Degrau): boolean {
  return d === "teste" || d === "parcial" || d === "ligada";
}

export function ehDegrau(v: unknown): v is Degrau {
  return typeof v === "string" && (DEGRAUS as readonly string[]).includes(v);
}

export function proximoDegrau(atual: Degrau): Degrau | null {
  const i = DEGRAUS.indexOf(atual);
  return i >= 0 && i < DEGRAUS.length - 1 ? DEGRAUS[i + 1] : null;
}

/** Degraus para onde se pode descer sem desligar tudo. Desligar tudo é outro botão, que também para as conversas abertas. */
export function degrausParaDescer(atual: Degrau): Degrau[] {
  const i = DEGRAUS.indexOf(atual);
  return DEGRAUS.filter((d, j) => j < i && d !== "desligada");
}

export type SituacaoParaSubir = {
  atual: Degrau;
  percentual: number;
  numerosDeTeste: readonly string[];
  /** O link que o robô manda no ramo de parceiro. Sem ele, quem pede cadastro vai para a equipe. */
  linkDeParceiro: string | null;
};

export type PodeSubir =
  | { pode: true; para: Degrau; avisos: string[] }
  | { pode: false; para: Degrau | null; motivo: string };

/**
 * O que falta para subir um degrau. Quem decide de verdade é o banco; estas
 * exigências são do cuidado da tela: teste sem número de teste não atende
 * ninguém, e parcial sem porcentagem só atende os números de teste.
 */
export function podeSubir(s: SituacaoParaSubir): PodeSubir {
  const para = proximoDegrau(s.atual);
  if (!para) return { pode: false, para: null, motivo: "A triagem já está no último degrau." };
  const avisos: string[] = [];
  if (para === "teste" && s.numerosDeTeste.length === 0) {
    return {
      pode: false,
      para,
      motivo:
        "Cadastre pelo menos um número de teste antes de subir. Sem ele, ninguém receberia a mensagem de teste.",
    };
  }
  if (para === "parcial" && s.percentual < 1) {
    return {
      pode: false,
      para,
      motivo: "Escolha uma porcentagem acima de zero antes de subir para parcial.",
    };
  }
  if (mandaMensagemDeVerdade(para) && !s.linkDeParceiro) {
    avisos.push(
      "Não há link de cadastro de parceiro. Quem pedir para ser parceiro será passado para a equipe, sem receber o link.",
    );
  }
  return { pode: true, para, avisos };
}

/** Frase do botão grande, no degrau atual. */
export function textoDoBotaoDeSubir(atual: Degrau): string {
  const para = proximoDegrau(atual);
  if (!para) return "Já está no último degrau";
  return `Subir para ${ROTULO_DO_DEGRAU[para].toLowerCase()}`;
}

/** O aviso de confirmação de quem vai fazer o robô falar com cliente de verdade. */
export function avisoDeConfirmacao(para: Degrau, percentual: number): string | null {
  if (para === "teste")
    return "A partir de agora o robô vai responder de verdade, mas só para os números de teste da lista.";
  if (para === "parcial")
    return `A partir de agora o robô vai responder de verdade para os números de teste e para cerca de ${percentual} de cada 100 contatos novos.`;
  if (para === "ligada")
    return "A partir de agora o robô vai responder de verdade para todo contato novo que escrever primeiro.";
  return null;
}
