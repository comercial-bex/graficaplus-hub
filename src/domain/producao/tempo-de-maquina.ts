/**
 * Tempo de máquina por tipo de equipamento.
 *
 * Cada máquina cobra de um jeito, e usar a conta errada erra para os dois
 * lados. m²/h serve para a impressora e não serve para nenhuma das outras:
 *
 *   impressão     área ÷ m²/h                      (a peça é a área)
 *   corte a laser comprimento do traçado ÷ mm/s    (a peça é o percurso)
 *                 + área gravada ÷ taxa de raster
 *   recorte       traçado ÷ mm/s + DECAPAGEM       (a máquina é rápida;
 *                                                   a mão de obra manda)
 *   marcação      por PEÇA: setup + n × (marcar + trocar)
 *
 * As velocidades vêm de tabela por material e espessura, não de um número
 * único: acrílico de 3 mm corta a 25 mm/s, de 10 mm a 3 mm/s. Um único
 * "mm/s da máquina" erraria por 8× entre os dois.
 *
 * Toda função devolve a MEMÓRIA DE CÁLCULO em português junto do número. Tempo
 * que vira custo e custo que vira preço: se não dá para conferir a conta,
 * ninguém confere.
 */

export type BaseCobranca = "area" | "tempo" | "peca" | "metro_linear";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);
const min = (n: number) => `${r2(n).toLocaleString("pt-BR")} min`;

/* ------------------------------------------------------------------------ */
/* Impressão: a peça é a área                                                */
/* ------------------------------------------------------------------------ */

export function tempoImpressao(entrada: { areaM2: number; velocidadeM2H: number; setupMin?: number }) {
  const area = num(entrada.areaM2);
  const vel = num(entrada.velocidadeM2H);
  const setup = num(entrada.setupMin);
  if (area <= 0 || vel <= 0) {
    return { minutos: setup, memoria: "sem área ou sem velocidade em m²/h — informe as horas", derivado: false };
  }
  const minutos = (area / vel) * 60 + setup;
  return {
    minutos: r2(minutos),
    derivado: true,
    memoria: `${area.toLocaleString("pt-BR")} m² ÷ ${vel} m²/h = ${min((area / vel) * 60)}${setup ? ` + ${min(setup)} de setup` : ""}`,
  };
}

/* ------------------------------------------------------------------------ */
/* Corte a laser CO2: a peça é o percurso                                    */
/* ------------------------------------------------------------------------ */

export type VelocidadePorMaterial = {
  material: string;
  espessuraMm: number;
  velocidadeMmS: number;
  /** Material que esta máquina NÃO pode processar. */
  vetado?: boolean;
  motivo?: string;
};

/**
 * Escolhe a velocidade da tabela para o material e a espessura.
 *
 * O VETO vem antes de tudo: material vetado não tem espessura que sirva, e a
 * linha é devolvida inteira para quem chamou recusar com o motivo na mão.
 * "Não medimos ainda" e "isso libera cloro dentro da sua máquina" não podem sair
 * na tela com a mesma cara.
 *
 * Espessura sem linha exata usa a MAIS PRÓXIMA ACIMA: cortar 4 mm com a
 * velocidade dos 5 mm é mais lento do que precisa, mas cortar com a dos 3 mm
 * não atravessa a chapa — e peça que não atravessa é peça refeita.
 */
export function velocidadeDeCorte(
  tabela: VelocidadePorMaterial[],
  material: string,
  espessuraMm: number,
): VelocidadePorMaterial | null {
  const doMaterial = tabela
    .filter((v) => v.material.toLowerCase() === material.toLowerCase())
    .sort((a, b) => a.espessuraMm - b.espessuraMm);
  if (doMaterial.length === 0) return null;
  const vetado = doMaterial.find((v) => v.vetado);
  if (vetado) return vetado;
  return doMaterial.find((v) => v.espessuraMm >= espessuraMm) ?? doMaterial[doMaterial.length - 1];
}

export function tempoCorteLaser(entrada: {
  comprimentoCorteM: number;
  material: string;
  espessuraMm: number;
  tabela: VelocidadePorMaterial[];
  /** Área gravada em raster, se houver. */
  areaGravacaoCm2?: number;
  velocidadeGravacaoMmS?: number;
  intervaloLinhaMm?: number;
  setupMin?: number;
  /** Tempo mínimo cobrado, prática do mercado (10 min). */
  minimoMin?: number;
}) {
  const setup = num(entrada.setupMin);
  const minimo = num(entrada.minimoMin);
  const partes: string[] = [];
  let minutos = setup;
  if (setup > 0) partes.push(`${min(setup)} de setup`);

  const vel = velocidadeDeCorte(entrada.tabela, entrada.material, entrada.espessuraMm);

  // Veto antes da conta: não existe tempo para um trabalho que não pode ser
  // feito, e o orçamento tem que recusar em vez de pedir a hora à mão.
  if (vel?.vetado) {
    return { minutos: 0, derivado: false, vetado: true, memoria: vel.motivo ?? `${entrada.material} não pode ser processado nesta máquina` };
  }

  const comprimento = num(entrada.comprimentoCorteM);
  let derivado = false;

  if (comprimento > 0) {
    if (!vel) {
      return {
        minutos: Math.max(minimo, setup),
        derivado: false,
        vetado: false,
        memoria: `sem velocidade cadastrada para ${entrada.material} — informe o tempo`,
      };
    }
    // Percurso em mm ÷ mm/s = segundos. O +25% é a aceleração e frenagem em
    // cada curva: laser não corta a velocidade nominal num contorno cheio de
    // cantos, e sem esse ajuste toda peça pequena sai subestimada.
    const segundos = ((comprimento * 1000) / vel.velocidadeMmS) * 1.25;
    minutos += segundos / 60;
    derivado = true;
    partes.push(
      `${comprimento.toLocaleString("pt-BR")} m de corte ÷ ${vel.velocidadeMmS} mm/s (${vel.material} ${vel.espessuraMm} mm) × 1,25 de curvas = ${min(segundos / 60)}`,
    );
  }

  const area = num(entrada.areaGravacaoCm2);
  if (area > 0) {
    const velG = num(entrada.velocidadeGravacaoMmS) || 250;
    const intervalo = num(entrada.intervaloLinhaMm) || 0.1;
    // Raster varre a área linha a linha: percurso = área ÷ intervalo entre
    // linhas. A 0,1 mm, cada cm² são 100 passadas de 10 mm = 1.000 mm.
    const percursoMm = (area * 100) / intervalo;
    const segundos = (percursoMm / velG) * 1.3; // vai-e-volta com frenagem nas bordas
    minutos += segundos / 60;
    derivado = true;
    partes.push(
      `${area.toLocaleString("pt-BR")} cm² gravados a ${velG} mm/s com ${intervalo} mm entre linhas = ${min(segundos / 60)}`,
    );
  }

  const cobrado = Math.max(minutos, minimo);
  if (minimo > 0 && cobrado > minutos) partes.push(`mínimo de ${min(minimo)} aplicado`);

  return { minutos: r2(cobrado), derivado, vetado: false, memoria: partes.join(" · ") || "nada a cortar" };
}

/* ------------------------------------------------------------------------ */
/* Recorte de vinil: a máquina é rápida, a decapagem manda                   */
/* ------------------------------------------------------------------------ */

export type ComplexidadeDecapagem = "simples" | "media" | "detalhada";

/**
 * Minutos de decapagem por m² de vinil, por complexidade.
 *
 * Números de calibração, não de fabricante: nenhum fornecedor publica isso
 * porque depende de quem decapa. São ponto de partida para a oficina medir e
 * ajustar — e por isso ficam expostos, não enterrados na conta.
 *
 *   simples    letras grandes, formas cheias        3 min/m²
 *   media      logos, textos médios                 8 min/m²
 *   detalhada  texto pequeno, contornos finos      20 min/m²
 */
export const DECAPAGEM_MIN_POR_M2: Record<ComplexidadeDecapagem, number> = {
  simples: 3,
  media: 8,
  detalhada: 20,
};

export function tempoRecorte(entrada: {
  comprimentoCorteM: number;
  velocidadeMmS: number;
  areaM2: number;
  complexidade: ComplexidadeDecapagem;
  setupMin?: number;
  /** Aplicação de fita de transporte, min por m². */
  transporteMinPorM2?: number;
}) {
  const setup = num(entrada.setupMin);
  const comprimento = num(entrada.comprimentoCorteM);
  const vel = num(entrada.velocidadeMmS);
  const area = num(entrada.areaM2);
  const transporte = entrada.transporteMinPorM2 ?? 2;

  const minutosMaquina = comprimento > 0 && vel > 0 ? ((comprimento * 1000) / vel / 60) * 1.2 : 0;
  const minutosDecapagem = area * DECAPAGEM_MIN_POR_M2[entrada.complexidade];
  const minutosTransporte = area * transporte;
  const total = setup + minutosMaquina + minutosDecapagem + minutosTransporte;

  const partes: string[] = [];
  if (setup > 0) partes.push(`${min(setup)} de setup`);
  if (minutosMaquina > 0)
    partes.push(`${comprimento.toLocaleString("pt-BR")} m de corte ÷ ${vel} mm/s = ${min(minutosMaquina)} de máquina`);
  partes.push(
    `${area.toLocaleString("pt-BR")} m² × ${DECAPAGEM_MIN_POR_M2[entrada.complexidade]} min/m² (${entrada.complexidade}) = ${min(minutosDecapagem)} de decapagem`,
  );
  if (minutosTransporte > 0) partes.push(`${min(minutosTransporte)} de fita de transporte`);

  return {
    minutos: r2(total),
    minutosMaquina: r2(minutosMaquina),
    minutosMaoDeObra: r2(minutosDecapagem + minutosTransporte),
    derivado: true,
    memoria: partes.join(" · "),
  };
}

/* ------------------------------------------------------------------------ */
/* Marcação a fiber: por peça                                                */
/* ------------------------------------------------------------------------ */

export function tempoMarcacaoFiber(entrada: {
  pecas: number;
  areaMarcacaoCm2: number;
  velocidadeMmS: number;
  intervaloLinhaMm?: number;
  passadas?: number;
  setupMin?: number;
  /** Tirar uma peça e pôr a próxima, em segundos. */
  trocaPecaSeg?: number;
  rotativo?: boolean;
}) {
  const pecas = Math.max(0, Math.floor(num(entrada.pecas)));
  const area = num(entrada.areaMarcacaoCm2);
  const vel = num(entrada.velocidadeMmS);
  const intervalo = num(entrada.intervaloLinhaMm) || 0.05;
  const passadas = Math.max(1, num(entrada.passadas) || 1);
  const setup = num(entrada.setupMin);
  // Peça em eixo rotativo é presa em castanha, alinhada e conferida: leva
  // três vezes o que uma peça plana leva para trocar.
  //
  // `!= null`, e não `||`: zero segundos de troca é um valor legítimo (peça
  // já posicionada em gabarito), e `0 || 15` o trataria como "não informado".
  // O teste pegou exatamente isso.
  const troca = entrada.trocaPecaSeg != null ? num(entrada.trocaPecaSeg) : entrada.rotativo ? 45 : 15;

  if (pecas <= 0) return { minutos: r2(setup), porPeca: 0, derivado: false, memoria: "nenhuma peça" };
  if (area <= 0 || vel <= 0) {
    return { minutos: r2(setup), porPeca: 0, derivado: false, memoria: "sem área de marcação ou velocidade — informe o tempo por peça" };
  }

  const percursoMm = ((area * 100) / intervalo) * passadas;
  const marcarSeg = percursoMm / vel;
  const porPecaSeg = marcarSeg + troca;
  const total = setup + (pecas * porPecaSeg) / 60;

  return {
    minutos: r2(total),
    porPeca: r3(porPecaSeg / 60),
    derivado: true,
    memoria:
      `${area.toLocaleString("pt-BR")} cm² a ${vel} mm/s (${intervalo} mm entre linhas${passadas > 1 ? `, ${passadas} passadas` : ""}) = ${r2(marcarSeg)} s + ${troca} s de troca${entrada.rotativo ? " (rotativo)" : ""} por peça` +
      ` · ${pecas} peças${setup ? ` + ${min(setup)} de setup` : ""} = ${min(total)}`,
  };
}

/* ------------------------------------------------------------------------ */
/* Tempo vira dinheiro                                                       */
/* ------------------------------------------------------------------------ */

export function custoDoTempo(entrada: {
  minutos: number;
  custoHora: number;
  potenciaKw?: number;
  tarifaKwh?: number;
}) {
  const horas = num(entrada.minutos) / 60;
  const maquina = horas * num(entrada.custoHora);
  const energia = horas * num(entrada.potenciaKw) * num(entrada.tarifaKwh);
  return {
    horas: r3(horas),
    custoMaquina: r2(maquina),
    custoEnergia: r2(energia),
    total: r2(maquina + energia),
  };
}
