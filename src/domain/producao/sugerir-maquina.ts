/**
 * Qual máquina faz este produto.
 *
 * Nenhum dos 31 produtos tem máquina padrão, e por isso o cálculo de
 * aproveitamento de bobina cai na máquina mais larga do parque — um palpite que
 * o card avisa na tela, mas ainda é palpite. Este módulo SUGERE, com o motivo
 * escrito, para alguém confirmar em lote. Ele nunca grava.
 *
 * Três respostas possíveis, e a terceira é a mais valiosa:
 *
 *   uma máquina   o produto roda no parque
 *   nenhuma       é SERVIÇO (arte, instalação, deslocamento) — não tem máquina,
 *                 e forçar uma seria inventar processo
 *   fora do parque  o produto existe no catálogo e NENHUMA máquina da casa faz:
 *                 chapa de ACM e PVC expandido são de tupia, e o laser de CO2
 *                 não pode cortar nem uma nem outra (alumínio e cloro).
 *                 Cartão e panfleto são offset de terceiro.
 *
 * A terceira resposta é o achado: a casa vende coisas que ela não produz, e
 * ninguém tinha listado quais.
 */

export type Produto = {
  id: string;
  nome: string;
  categoria: string | null;
  tipo: string | null;
  unidade: string | null;
  maquina_padrao_id: string | null;
  ativo?: boolean;
};

export type MaquinaDisponivel = {
  id: string;
  nome: string;
  base_cobranca: string | null;
  velocidade_m2_h: number | null;
};

export type Sugestao =
  | { tipo: "maquina"; maquinaId: string; maquinaNome: string; motivo: string }
  | { tipo: "sem_maquina"; motivo: string }
  | { tipo: "fora_do_parque"; motivo: string };

const tem = (texto: string, ...termos: string[]) => {
  const t = texto.toLowerCase();
  return termos.some((x) => t.includes(x));
};

/** Acha a máquina pela base de cobrança, que é o papel dela na oficina. */
const porBase = (maquinas: MaquinaDisponivel[], base: string) =>
  maquinas.find((m) => m.base_cobranca === base);

export function sugerirMaquina(p: Produto, maquinas: MaquinaDisponivel[]): Sugestao {
  const nome = p.nome ?? "";
  const cat = p.categoria ?? "";

  // Serviço não tem máquina. Vem antes de tudo: "Impressão 3D (serviço)" tem a
  // palavra impressão no nome e cairia na impressora de lona.
  if (p.tipo === "servico") {
    if (tem(nome, "3d")) {
      const bambu = maquinas.find((m) => tem(m.nome, "bambu", "3d"));
      if (bambu) {
        return { tipo: "maquina", maquinaId: bambu.id, maquinaNome: bambu.nome, motivo: "serviço de impressão 3D" };
      }
    }
    return {
      tipo: "sem_maquina",
      motivo: "é serviço (arte, acabamento, instalação) — o custo é hora de gente, não de máquina",
    };
  }

  // Material que nenhuma máquina da casa processa. Vem antes da categoria
  // porque "Placa ACM" está em comunicação visual junto com fachada de lona,
  // que a impressora faz.
  if (tem(nome, "acm")) {
    return {
      tipo: "fora_do_parque",
      motivo: "ACM é miolo entre chapas de alumínio: o laser de CO2 não corta metal. É tupia ou guilhotina com fresa em V",
    };
  }
  if (tem(nome, "pvc")) {
    return {
      tipo: "fora_do_parque",
      motivo: "PVC no laser libera cloro, que corrói a máquina. Corte com tupia, serra ou estilete",
    };
  }
  if (cat === "brindes" || tem(nome, "cartão de visita", "panfleto", "milheiro")) {
    return { tipo: "fora_do_parque", motivo: "impressão offset — é de terceiro, não do parque" };
  }
  // A4 e A3 são FOLHA. A única impressora da casa é eco-solvente em bobina de
  // 1,80 m: dá para tirar um A4 dela, mas seria cortar 1,80 de largura para
  // usar 21 cm, com tinta de solvente que a folha de escritório não pede.
  if (tem(nome, " a4", " a3", "a4 ", "a3 ") || /\ba[34]\b/i.test(nome)) {
    return {
      tipo: "fora_do_parque",
      motivo: "impressão em folha A4/A3 — a i1600 é bobina de 1,80 m em eco-solvente; sai de laser/jato de tinta ou de terceiro",
    };
  }

  // Recorte antes de impressão: "adesivo vinil recortado" tem as duas palavras.
  if (tem(nome, "recortad", "recorte")) {
    const recorte = porBase(maquinas, "metro_linear");
    if (recorte) {
      return { tipo: "maquina", maquinaId: recorte.id, maquinaNome: recorte.nome, motivo: "vinil recortado, sem impressão" };
    }
  }

  if (tem(nome, "letra caixa", "gravaç", "acrílico", "acrilico", "mdf")) {
    const laser = porBase(maquinas, "tempo");
    if (laser) {
      return { tipo: "maquina", maquinaId: laser.id, maquinaNome: laser.nome, motivo: "corte e gravação em chapa" };
    }
  }

  if (tem(nome, "chaveiro", "marcaç", "brinde metal", "copo", "garrafa")) {
    const fiber = porBase(maquinas, "peca");
    if (fiber) {
      return { tipo: "maquina", maquinaId: fiber.id, maquinaNome: fiber.nome, motivo: "marcação peça por peça" };
    }
  }

  // Impressão: a categoria e a unidade em m² são o sinal mais forte.
  if (
    cat === "impressao_grande_formato" ||
    cat === "adesivos" ||
    tem(nome, "lona", "impress", "banner", "adesivo", "fachada", "testeira", "praguinha", "prag", "bola")
  ) {
    const impressora = porBase(maquinas, "area");
    if (impressora) {
      return {
        tipo: "maquina",
        maquinaId: impressora.id,
        maquinaNome: impressora.nome,
        motivo: cat === "adesivos" ? "adesivo impresso em bobina" : "impressão em bobina",
      };
    }
  }

  return { tipo: "sem_maquina", motivo: "não deu para inferir pelo nome nem pela categoria — escolha à mão" };
}

/** Só os produtos que ainda não têm máquina e para os quais há uma a sugerir. */
export function sugestoesParaAplicar(
  produtos: Produto[],
  maquinas: MaquinaDisponivel[],
): { produto: Produto; sugestao: Extract<Sugestao, { tipo: "maquina" }> }[] {
  return produtos
    .filter((p) => !p.maquina_padrao_id)
    .map((p) => ({ produto: p, sugestao: sugerirMaquina(p, maquinas) }))
    .filter((x): x is { produto: Produto; sugestao: Extract<Sugestao, { tipo: "maquina" }> } =>
      x.sugestao.tipo === "maquina",
    );
}
