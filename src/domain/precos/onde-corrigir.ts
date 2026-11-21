/**
 * ONDE SE CORRIGE CADA PENDÊNCIA DO CUSTO (21/11/2026).
 *
 * O dono abriu a pasta do produto, viu "O que falta para o custo fechar: sem matéria-prima na receita" e perguntou
 * onde se responde isso. A frase dizia o que faltava e não dizia onde se preenche. Regra daqui para frente: todo
 * aviso ou pendência do custeio diz, em destaque e em letra menor, "Vá até tal seção, tal módulo", e leva a pessoa
 * até lá (botão que troca de aba, rola e destaca o campo, ou abre o outro módulo na aba certa).
 *
 * Este arquivo é o único lugar que sabe o destino de cada pendência. A pasta do produto, a ficha da Tabela de
 * preços e o painel de avisos de Preços por produto leem daqui, para os três nunca discordarem. O tipo Record obriga
 * toda pendência nova a ganhar destino, e o teste confere que a aba, o campo e a rota existem de verdade.
 *
 * Frases sem travessão, seta nem parênteses, que é como o dono lê.
 */
import type { AbaDaPasta } from "@/domain/catalogo/pasta-do-produto";

/** Para onde o botão leva. */
export type AlvoDaCorrecao =
  /** A pasta do produto, na aba pedida, com o campo (ou cartão) destacado. */
  | { tipo: "pasta"; aba: AbaDaPasta; campo: string }
  /** A Planilha de custos, já na aba certa. */
  | { tipo: "planilha"; aba: AbaDaPlanilha }
  /** Outro módulo, aberto na primeira tela. */
  | { tipo: "rota"; rota: RotaDeCorrecao }
  /** A própria tela onde o aviso apareceu: não há para onde levar, só o que fazer. */
  | { tipo: "aqui" };

export type AbaDaPlanilha = "materiais" | "mao-obra" | "tarifas";
export const ABAS_DA_PLANILHA: AbaDaPlanilha[] = ["materiais", "mao-obra", "tarifas"];

export type RotaDeCorrecao = "/materiais" | "/maquinas" | "/custos-producao";

export type OndeCorrigir = {
  /** "Vá até a aba Parâmetros desta pasta, no cartão Materiais deste produto." Uma frase só, a que vai em destaque. */
  vaAte: string;
  /** O que fazer lá, em uma ou duas frases. */
  fazer: string;
  /** O texto do botão. Vazio quando o alvo é "aqui": não há para onde levar. */
  botao: string;
  alvo: AlvoDaCorrecao;
};

/**
 * Ids do que a pasta destaca ao chegar. Cada um precisa existir como `id="..."` na pasta, e o teste confere.
 * A busca da pasta (`buscaDaPasta`) também aceita estes campos no endereço, para o link da ficha de preços
 * abrir a pasta já no lugar certo.
 */
export const CAMPO_DO_QUADRO_DO_CUSTO = "pasta-custo-da-peca";
export const CAMPO_DOS_MATERIAIS = "pasta-materiais";
export const CAMPO_DO_TEMPO = "pasta-tempo";
export const CAMPO_DA_MAQUINA = "pasta-maquina";
export const CAMPO_DO_CUSTO_DIGITADO = "pasta-custo-medio";

export const CAMPOS_DE_CORRECAO_DA_PASTA: { aba: AbaDaPasta; campo: string }[] = [
  { aba: "preco", campo: CAMPO_DO_QUADRO_DO_CUSTO },
  { aba: "preco", campo: CAMPO_DO_CUSTO_DIGITADO },
  { aba: "parametros", campo: CAMPO_DOS_MATERIAIS },
  { aba: "parametros", campo: CAMPO_DO_TEMPO },
  { aba: "parametros", campo: CAMPO_DA_MAQUINA },
];

// ------------------------------------------------------------------------------------------------------
// As faltas da ficha técnica ("O que falta para o custo fechar")
// ------------------------------------------------------------------------------------------------------

export type ChaveDaFalta =
  | "sem_materia_prima"
  | "custo_digitado"
  | "sem_tempo"
  | "sem_maquina"
  | "sem_mao_de_obra";

const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Contexto que muda a frase. `custoDigitado`: o custo de matéria-prima que hoje vale por ter sido digitado à mão
 * (sem receita). É o caso do acrílico espelhado, com R$ 400,00 de matéria-prima e nenhum material na receita.
 */
export type ContextoDaFalta = { custoDigitado?: number | null };

export function ondeCorrigirFalta(chave: ChaveDaFalta, contexto: ContextoDaFalta = {}): OndeCorrigir {
  switch (chave) {
    case "sem_materia_prima": {
      const digitado = contexto.custoDigitado != null && contexto.custoDigitado > 0 ? contexto.custoDigitado : null;
      return {
        vaAte: "Vá até a aba Parâmetros desta pasta, no cartão Materiais deste produto.",
        fazer:
          (digitado != null
            ? `Hoje vale o custo de ${reais(digitado)}, digitado à mão, que não acompanha o preço de compra. `
            : "") +
          "Inclua ao menos um material com a quantidade que a peça gasta. Com a receita pronta, o custo da matéria-prima vem do preço de compra do material e se atualiza sozinho.",
        botao: "Ir para Materiais deste produto",
        alvo: { tipo: "pasta", aba: "parametros", campo: CAMPO_DOS_MATERIAIS },
      };
    }
    case "custo_digitado":
      return {
        vaAte: "Vá até a aba Preço desta pasta, no campo Custo do cadastro.",
        fazer:
          "Item comprado pronto: o custo digitado vale. Atualize o campo quando o preço de compra mudar.",
        botao: "Ir para o campo Custo do cadastro",
        alvo: { tipo: "pasta", aba: "preco", campo: CAMPO_DO_CUSTO_DIGITADO },
      };
    case "sem_tempo":
      return {
        vaAte: "Vá até a aba Parâmetros desta pasta, no cartão Máquina e material principal, campo Tempo estimado.",
        fazer: "Informe quantos minutos a peça leva para ficar pronta. Sem o tempo, o custo não leva mão de obra nem rateio.",
        botao: "Ir para o campo Tempo estimado",
        alvo: { tipo: "pasta", aba: "parametros", campo: CAMPO_DO_TEMPO },
      };
    case "sem_maquina":
      return {
        vaAte: "Vá até a aba Parâmetros desta pasta, no cartão Máquina e material principal, campo Máquina padrão.",
        fazer: "Escolha a máquina onde a peça é feita. É dela que vêm o custo por hora e a velocidade de produção.",
        botao: "Ir para o campo Máquina padrão",
        alvo: { tipo: "pasta", aba: "parametros", campo: CAMPO_DA_MAQUINA },
      };
    case "sem_mao_de_obra":
      return {
        vaAte: "Vá até o módulo Planilha de custos, aba Mão de obra.",
        fazer:
          "Informe o custo por hora de ao menos uma função, com os encargos. O custo de mão de obra do produto é o tempo dele vezes essa hora.",
        botao: "Ir para Planilha de custos, Mão de obra",
        alvo: { tipo: "planilha", aba: "mao-obra" },
      };
  }
}

export const CHAVES_DAS_FALTAS: ChaveDaFalta[] = [
  "sem_materia_prima",
  "custo_digitado",
  "sem_tempo",
  "sem_maquina",
  "sem_mao_de_obra",
];

// ------------------------------------------------------------------------------------------------------
// Os avisos de Preços por produto (avisosDoProduto)
// ------------------------------------------------------------------------------------------------------

/**
 * Os códigos de `avisosDoProduto` (custo-real.ts). Escrito como texto, e não importado, para este arquivo não
 * depender do outro; o teste confere que todo código de lá que se corrige com dado tem destino aqui.
 */
export type CodigoDoAviso =
  | "sem_custo_real"
  | "abaixo_do_custo"
  | "parceiro_abaixo_do_piso_liquido"
  | "parceiro_acima_do_balcao"
  | "material_sem_custo"
  | "sem_mao_de_obra"
  | "sem_tinta"
  | "custo_incompleto"
  | "margem_liquida_abaixo_do_minimo"
  | "abaixo_da_regra_de_tres"
  | "abaixo_do_minimo_recomendado"
  | "tempo_presumido";

const AQUI_NO_PRECO_DO_BALCAO: OndeCorrigir = {
  vaAte: "Corrija aqui mesmo, no campo do preço de balcão deste produto.",
  fazer: "Digite o preço novo e toque em Propor preço. O gerente aprova, e o preço só muda depois disso.",
  botao: "",
  alvo: { tipo: "aqui" },
};

const QUADRO_DO_CUSTO: OndeCorrigir = {
  vaAte: "Vá até a aba Preço da pasta deste produto, no quadro O que falta para o custo fechar.",
  fazer: "O quadro lista, item por item, o que preencher, e cada item leva até o campo.",
  botao: "Abrir o quadro do custo",
  alvo: { tipo: "pasta", aba: "preco", campo: CAMPO_DO_QUADRO_DO_CUSTO },
};

/** Onde corrigir cada aviso. Aviso sem entrada aqui não se resolve com um dado a preencher (é só informação). */
export const ONDE_CORRIGIR_O_AVISO: Partial<Record<CodigoDoAviso, OndeCorrigir>> = {
  sem_custo_real: QUADRO_DO_CUSTO,
  sem_mao_de_obra: QUADRO_DO_CUSTO,
  material_sem_custo: {
    vaAte: "Vá até o módulo Materiais e abra o material da ficha que está sem custo.",
    fazer:
      "Preencha o custo de compra do material. O custo dos produtos que usam esse material se recalcula sozinho.",
    botao: "Ir para Materiais",
    alvo: { tipo: "rota", rota: "/materiais" },
  },
  sem_tinta: {
    vaAte: "Vá até a aba Parâmetros da pasta deste produto, no cartão Materiais deste produto.",
    fazer:
      "Inclua a tinta, o material em ml, com o consumo por m². Se o consumo médio da casa já cobre, preencha-o no módulo Custos fixos e mão de obra.",
    botao: "Ir para Materiais deste produto",
    alvo: { tipo: "pasta", aba: "parametros", campo: CAMPO_DOS_MATERIAIS },
  },
  custo_incompleto: {
    vaAte: "Vá até o módulo Custos fixos e mão de obra, grupo da plotter.",
    fazer:
      "Informe a manutenção, a limpeza e o cabeçote da plotter. O que for do produto, como material, tempo e mão de obra, aparece na aba Preço da pasta, no quadro O que falta para o custo fechar.",
    botao: "Ir para Custos fixos e mão de obra",
    alvo: { tipo: "rota", rota: "/custos-producao" },
  },
  tempo_presumido: {
    vaAte: "Vá até o módulo Máquinas e abra a máquina padrão do produto.",
    fazer: "Preencha a velocidade da máquina em m² por hora. Com ela, o tempo deixa de ser presumido.",
    botao: "Ir para Máquinas",
    alvo: { tipo: "rota", rota: "/maquinas" },
  },
  abaixo_do_custo: AQUI_NO_PRECO_DO_BALCAO,
  margem_liquida_abaixo_do_minimo: AQUI_NO_PRECO_DO_BALCAO,
  abaixo_do_minimo_recomendado: AQUI_NO_PRECO_DO_BALCAO,
  // abaixo_da_regra_de_tres fica de fora de propósito: o aviso diz que é só referência e não manda subir o preço.
};

export function ondeCorrigirAviso(codigo: string): OndeCorrigir | null {
  return ONDE_CORRIGIR_O_AVISO[codigo as CodigoDoAviso] ?? null;
}

/** O endereço que o botão abre, para tela que usa `<a href>` ou para o teste. Nulo quando o alvo é "aqui". */
export function enderecoDoAlvo(alvo: AlvoDaCorrecao, produtoId: string): string | null {
  switch (alvo.tipo) {
    case "pasta":
      return `/produtos/${produtoId}?aba=${alvo.aba}&campo=${alvo.campo}`;
    case "planilha":
      return `/planilha-custos?aba=${alvo.aba}`;
    case "rota":
      return alvo.rota;
    case "aqui":
      return null;
  }
}

/** A aba da Planilha de custos que o endereço pede, ou "materiais" (a primeira) quando não pede ou pede errado. */
export function abaDaPlanilhaPedida(busca: Record<string, unknown>): AbaDaPlanilha | undefined {
  return typeof busca.aba === "string" ? ABAS_DA_PLANILHA.find((a) => a === busca.aba) : undefined;
}

// ------------------------------------------------------------------------------------------------------
// As faltas do custo de um acabamento (função custo_do_acabamento_interno)
// ------------------------------------------------------------------------------------------------------

/**
 * O banco devolve a falta como frase. Estas são as sete frases vivas de `custo_do_acabamento_interno` (migração
 * 20261025400000, conferida no banco em 21/11/2026); o teste lê a migração e confirma que cada uma tem destino.
 * Frase que o banco passar a escrever e que não esteja aqui cai no destino geral, que diz para conferir o cadastro
 * do acabamento: nunca fica sem orientação.
 */
export function ondeCorrigirFaltaDoAcabamento(falta: string): OndeCorrigir {
  const t = falta.toLowerCase();
  if (/^máquina .* sem custo por hora$/.test(t)) {
    return {
      vaAte: "Vá até o módulo Máquinas e abra a máquina deste acabamento.",
      fazer: "Preencha o custo por hora da máquina. Sem ele, o corte ou a gravação sai de graça no custo.",
      botao: "Ir para Máquinas",
      alvo: { tipo: "rota", rota: "/maquinas" },
    };
  }
  if (t.includes("sem máquina escolhida")) {
    return {
      vaAte: "Corrija aqui mesmo: toque no lápis deste acabamento e escolha a máquina.",
      fazer: "O processo é de máquina e precisa saber qual máquina faz o serviço.",
      botao: "",
      alvo: { tipo: "aqui" },
    };
  }
  if (t.startsWith("sem tempo")) {
    return {
      vaAte: "Corrija aqui mesmo: toque no lápis deste acabamento e preencha os tempos.",
      fazer: "Informe os minutos de máquina e de mão de obra, inclusive o preparo e a retirada. Sem tempo, o custo não leva o trabalho.",
      botao: "",
      alvo: { tipo: "aqui" },
    };
  }
  if (t.includes("mão de obra")) {
    return ondeCorrigirFalta("sem_mao_de_obra");
  }
  if (t.startsWith("material sem custo")) {
    return {
      vaAte: "Vá até o módulo Materiais e abra o material deste acabamento.",
      fazer: "Preencha o custo de compra do material. O custo do acabamento se recalcula sozinho.",
      botao: "Ir para Materiais",
      alvo: { tipo: "rota", rota: "/materiais" },
    };
  }
  return {
    vaAte: "Confira aqui mesmo: toque no lápis deste acabamento e veja os campos de custo.",
    fazer: "Esta falta ainda não tem um lugar indicado. Preencha o que estiver vazio no cadastro do acabamento.",
    botao: "",
    alvo: { tipo: "aqui" },
  };
}

// ------------------------------------------------------------------------------------------------------
// Produtos fora do ranking da tela Meta (sem tempo de produção, sem custo cadastrado)
// ------------------------------------------------------------------------------------------------------

export type MotivoForaDoRanking = "sem_tempo" | "sem_custo";

/** O mesmo destino da ficha para o tempo; o custo vai para o campo Custo do cadastro, na aba Preço. */
export function ondeCorrigirForaDoRanking(motivo: MotivoForaDoRanking): OndeCorrigir {
  if (motivo === "sem_tempo") return ondeCorrigirFalta("sem_tempo");
  return {
    vaAte: "Vá até a aba Preço da pasta deste produto, no campo Custo do cadastro.",
    fazer:
      "Digite o custo do material por unidade de venda. Se o produto tem receita de materiais, cadastre os materiais na aba Parâmetros e o custo vem sozinho.",
    botao: "Ir para o campo Custo do cadastro",
    alvo: { tipo: "pasta", aba: "preco", campo: CAMPO_DO_CUSTO_DIGITADO },
  };
}
