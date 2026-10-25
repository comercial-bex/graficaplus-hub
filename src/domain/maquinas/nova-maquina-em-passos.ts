/**
 * Nova máquina em passos (25/10/2026): tipo, identificação, capacidade, custo e consumo, revisão.
 *
 * Os números que importam para o sistema, e onde caem:
 *  - velocidade (m²/h) e largura útil (m) da plotter de impressão: o tempo de máquina e o encaixe
 *    da bobina no orçamento (14 m²/h = 4,3 min por m²);
 *  - potência (kW): entra no custo cheio como energia (kW × tarifa), além do custo por hora;
 *  - custo por hora: só quem vê custo preenche. Quem não vê não manda a chave, senão sobrescreveria
 *    o valor com 0.
 */

export type NumeroDoPasso = 1 | 2 | 3 | 4 | 5;

export const PASSOS_DA_MAQUINA: readonly { n: NumeroDoPasso; titulo: string; pergunta: string }[] =
  [
    { n: 1, titulo: "Tipo", pergunta: "Que máquina é?" },
    { n: 2, titulo: "Identificação", pergunta: "Qual o nome e o modelo?" },
    { n: 3, titulo: "Capacidade", pergunta: "O que ela aguenta?" },
    { n: 4, titulo: "Custo", pergunta: "Quanto consome e quanto custa por hora?" },
    { n: 5, titulo: "Revisão", pergunta: "Está tudo certo?" },
  ];

export type TipoDeMaquina = {
  /** o valor gravado em `maquinas.tipo` (os que já existem no cadastro) */
  chave: string;
  titulo: string;
  detalhe: string;
  icone: string;
  setor: "Impressão" | "Acabamento" | null;
  /** pede velocidade em m²/h e avanço (só a plotter de impressão tem os dois) */
  temVelocidade: boolean;
  /** pede a largura útil, em m */
  temLarguraUtil: boolean;
  /** sugestões para esta máquina (a pessoa confere): kW e largura útil mais comuns */
  potenciaKwPadrao?: number;
  largurasComuns?: readonly number[];
};

export const TIPOS_DE_MAQUINA: readonly TipoDeMaquina[] = [
  {
    chave: "plotter_impressao",
    titulo: "Plotter de impressão",
    detalhe: "lona, vinil, grande formato",
    icone: "Printer",
    setor: "Impressão",
    temVelocidade: true,
    temLarguraUtil: true,
    potenciaKwPadrao: 1,
    largurasComuns: [1.6, 1.8, 3.2],
  },
  {
    chave: "plotter_recorte",
    titulo: "Plotter de recorte",
    detalhe: "contorno de adesivo",
    icone: "Scissors",
    setor: "Acabamento",
    temVelocidade: false,
    temLarguraUtil: true,
    potenciaKwPadrao: 0.1,
    largurasComuns: [0.6, 0.9, 1.26],
  },
  {
    chave: "laser_co2",
    titulo: "Laser CO₂ (CNC)",
    detalhe: "corte de acrílico, MDF",
    icone: "Zap",
    setor: "Acabamento",
    temVelocidade: false,
    temLarguraUtil: true,
    potenciaKwPadrao: 1.9,
    largurasComuns: [0.6, 1],
  },
  {
    chave: "laser_fiber",
    titulo: "Laser fiber",
    detalhe: "marcação em metal",
    icone: "Zap",
    setor: "Acabamento",
    temVelocidade: false,
    temLarguraUtil: true,
    potenciaKwPadrao: 0.5,
  },
  {
    chave: "impressora_dtf_uv",
    titulo: "DTF UV",
    detalhe: "adesivo e transfer",
    icone: "Printer",
    setor: "Impressão",
    temVelocidade: false,
    temLarguraUtil: true,
    largurasComuns: [0.3, 0.6],
  },
  {
    chave: "impressora_3d",
    titulo: "Impressora 3D",
    detalhe: "filamento",
    icone: "Box",
    setor: null,
    temVelocidade: false,
    temLarguraUtil: false,
    potenciaKwPadrao: 0.15,
  },
];

export type RespostasDaMaquina = {
  tipo: TipoDeMaquina | null;
  nome: string;
  fabricante: string;
  modelo: string;
  numero_serie: string;
  velocidade_m2_h: string;
  largura_util_m: string;
  avanco_m: string;
  disponibilidade_pct: string;
  potencia_kw: string;
  custo_hora: string;
  setup_min: string;
};

export const RESPOSTAS_VAZIAS_DA_MAQUINA: RespostasDaMaquina = {
  tipo: null,
  nome: "",
  fabricante: "",
  modelo: "",
  numero_serie: "",
  velocidade_m2_h: "",
  largura_util_m: "",
  avanco_m: "",
  disponibilidade_pct: "100",
  potencia_kw: "",
  custo_hora: "",
  setup_min: "0",
};

const num = (t: string) => {
  const n = Number(String(t).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** Minutos de máquina por m², pela velocidade: 14 m²/h dão 4,3 min/m². Zero sem velocidade. */
export function minutosPorM2(velocidadeM2H: number): number {
  return velocidadeM2H > 0 ? Math.round((60 / velocidadeM2H) * 10) / 10 : 0;
}

/** O nome sugerido a partir do fabricante e do modelo, enquanto o nome está vazio. */
export function nomeSugerido(r: RespostasDaMaquina): string {
  return [r.tipo?.titulo, r.fabricante.trim(), r.modelo.trim()].filter(Boolean).join(" ");
}

/** Quando o tipo muda, os campos que ele traz ganham sugestões (sem apagar o que já foi digitado). */
export function respostasDoTipo(r: RespostasDaMaquina, t: TipoDeMaquina): RespostasDaMaquina {
  return {
    ...r,
    tipo: t,
    potencia_kw: r.potencia_kw || (t.potenciaKwPadrao ? String(t.potenciaKwPadrao) : ""),
  };
}

/** Por que o passo ainda não pode avançar, ou nada. */
export function pendenciaDoPassoDaMaquina(
  passo: NumeroDoPasso,
  r: RespostasDaMaquina,
): string | null {
  switch (passo) {
    case 1:
      return r.tipo ? null : "Escolha o tipo da máquina.";
    case 2:
      return r.nome.trim() ? null : "Dê um nome à máquina.";
    case 3: {
      if (r.tipo?.temVelocidade && num(r.velocidade_m2_h) <= 0) {
        return "Informe a velocidade em m²/h: é ela que dá o tempo de máquina de cada pedido.";
      }
      const d = num(r.disponibilidade_pct);
      return d > 0 && d <= 100 ? null : "A disponibilidade precisa estar entre 1 e 100%.";
    }
    case 4:
      return num(r.potencia_kw) >= 0 && num(r.custo_hora) >= 0
        ? null
        : "Os valores não podem ser negativos.";
    case 5:
      return null;
  }
}

/** A linha de `maquinas`. A chave de custo só vai para quem vê custo. */
export function maquinaDasRespostas(r: RespostasDaMaquina, podeVerCusto: boolean) {
  return {
    nome: r.nome.trim(),
    tipo: r.tipo?.chave ?? null,
    setor: r.tipo?.setor ?? null,
    ...(podeVerCusto ? { custo_hora: num(r.custo_hora) } : {}),
    potencia_kw: num(r.potencia_kw),
    setup_min: Math.round(num(r.setup_min)),
    velocidade_m2_h: r.tipo?.temVelocidade ? num(r.velocidade_m2_h) : 0,
    disponibilidade_pct: num(r.disponibilidade_pct),
    fabricante: r.fabricante.trim() || null,
    modelo: r.modelo.trim() || null,
    numero_serie: r.numero_serie.trim() || null,
    largura_util_m:
      r.tipo?.temLarguraUtil && num(r.largura_util_m) > 0 ? num(r.largura_util_m) : null,
    avanco_m: r.tipo?.temVelocidade ? num(r.avanco_m) : 0,
    ativa: true,
  };
}
