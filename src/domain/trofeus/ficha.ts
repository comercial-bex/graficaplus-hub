/**
 * A FICHA DE PRODUÇÃO DO TROFÉU (22/11/2026). Função pura: sem banco, sem React e SEM PREÇO NEM CUSTO. Quando o orçamento
 * vira OS, quem produz precisa saber o que cortar: as peças do modelo, em que material e espessura, com que medida na
 * altura escolhida, quantas no pedido todo, como cada uma é decorada e quanto tempo de laser o pedido pede.
 *
 * As medidas são as da conta de preço (`conta.ts`): cada peça do modelo está na altura de referência, e escolher outra
 * altura escala largura e altura na mesma proporção. O tempo de laser é a MESMA conta (corte do contorno pela velocidade
 * da espessura, gravação pela área, preparo uma vez por pedido); `tests/trofeus-ficha.test.ts` prova que as duas dão o
 * mesmo número. As medidas das peças ainda são estimadas das imagens do modelo: a ficha avisa (`provisorio`).
 */
import type { Decoracao, LinhaDoTrofeu, ModeloDeTrofeu, TipoDeArte } from "./conta";

export const ROTULO_DA_DECORACAO: Record<Decoracao, string> = {
  nenhuma: "Sem impressão",
  vinil_laminado: "Vinil impresso e laminado",
  gravacao_laser: "Gravação a laser",
};

export const ROTULO_DO_TIPO_DE_ARTE: Record<TipoDeArte, string> = {
  cliente_manda: "O cliente manda a arte pronta",
  adaptar_modelo: "Adaptar o modelo (nome e cores do cliente)",
  criacao_exclusiva: "Criação exclusiva da arte",
};

export type PecaDaFicha = {
  nome: string;
  material: string;
  espessuraMm: number;
  /** Medidas já na altura escolhida, em centímetros, com uma casa. */
  larguraCm: number;
  alturaCm: number;
  quantidadePorTrofeu: number;
  quantidadeNoPedido: number;
  decoracao: Decoracao;
  decoracaoRotulo: string;
};

export type ArteDaFicha = {
  tipo: TipoDeArte;
  tipoRotulo: string;
  alteracoesExtras: number;
  nomesIndividuais: number;
};

export type FichaDoTrofeu = {
  /** O item da OS (`itens_os.id`). */
  itemId: string;
  descricao: string;
  modelo: { id: string; nome: string; linha: LinhaDoTrofeu };
  quantidade: number;
  alturaCm: number;
  urgente: boolean;
  pecas: PecaDaFicha[];
  pecasPorTrofeu: number;
  pecasNoPedido: number;
  /** Área de acrílico do pedido todo, em m² úteis (sem a sobra de corte). */
  areaM2: number;
  /** Metros de contorno a cortar no pedido todo. */
  corteM: number;
  /** Minutos de laser do pedido todo (corte, gravação e um preparo). Nulo se falta velocidade de corte de uma espessura. */
  minutosDeLaser: number | null;
  /** Quais espessuras estão sem velocidade cadastrada (o tempo fica nulo). */
  semVelocidade: number[];
  arte: ArteDaFicha | null;
  /** As medidas e os tempos do modelo ainda são estimativa: a ficha avisa para conferir com a arte aprovada. */
  provisorio: boolean;
};

export type EntradaDaFicha = {
  itemId: string;
  descricao: string;
  quantidade: number;
  alturaCm: number;
  urgente: boolean;
  arte: { tipo: TipoDeArte; alteracoesExtras: number; nomesIndividuais: number } | null;
  modelo: ModeloDeTrofeu;
  /** Nome do material, pelo id. Material que sumiu do cadastro aparece como "Material sem nome". */
  nomesDosMateriais: Record<string, string>;
  velocidadeDeCorteMPorMin: Record<string, number>;
  gravacaoMinPorM2: number;
  preparoDoLaserMin: number;
  provisorio: boolean;
};

const arredonda = (n: number, casas: number) => {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
};

export function montarFicha(e: EntradaDaFicha): FichaDoTrofeu {
  const alturaM = e.alturaCm / 100;
  const f = alturaM / e.modelo.alturaDeReferenciaM;
  const quantidade = e.quantidade;

  let areaM2 = 0;
  let corteM = 0;
  let minutos = 0;
  const semVelocidade = new Set<number>();
  const pecas: PecaDaFicha[] = [];

  for (const p of e.modelo.pecas) {
    const larguraM = p.larguraM * f;
    const alturaDaPecaM = p.alturaM * f;
    const noPedido = p.quantidade * quantidade;
    const area = larguraM * alturaDaPecaM * noPedido;
    const perimetro = 2 * (p.larguraM + p.alturaM) * f * p.fatorDeForma * noPedido;
    areaM2 += area;
    corteM += perimetro;

    const velocidade = e.velocidadeDeCorteMPorMin[String(p.espessuraMm)];
    if (velocidade != null && velocidade > 0) minutos += perimetro / velocidade;
    else semVelocidade.add(p.espessuraMm);
    if (p.decoracao === "gravacao_laser") minutos += (larguraM * alturaDaPecaM * noPedido) * e.gravacaoMinPorM2;

    pecas.push({
      nome: p.nome,
      material: e.nomesDosMateriais[p.materialId] ?? "Material sem nome",
      espessuraMm: p.espessuraMm,
      larguraCm: arredonda(larguraM * 100, 1),
      alturaCm: arredonda(alturaDaPecaM * 100, 1),
      quantidadePorTrofeu: p.quantidade,
      quantidadeNoPedido: noPedido,
      decoracao: p.decoracao,
      decoracaoRotulo: ROTULO_DA_DECORACAO[p.decoracao],
    });
  }
  minutos += e.preparoDoLaserMin;

  return {
    itemId: e.itemId,
    descricao: e.descricao,
    modelo: { id: e.modelo.id, nome: e.modelo.nome, linha: e.modelo.linha },
    quantidade,
    alturaCm: e.alturaCm,
    urgente: e.urgente,
    pecas,
    pecasPorTrofeu: pecas.reduce((s, p) => s + p.quantidadePorTrofeu, 0),
    pecasNoPedido: pecas.reduce((s, p) => s + p.quantidadeNoPedido, 0),
    areaM2: arredonda(areaM2, 4),
    corteM: arredonda(corteM, 2),
    minutosDeLaser: semVelocidade.size > 0 ? null : arredonda(minutos, 1),
    semVelocidade: [...semVelocidade].sort((a, b) => a - b),
    arte: e.arte
      ? {
          tipo: e.arte.tipo,
          tipoRotulo: ROTULO_DO_TIPO_DE_ARTE[e.arte.tipo],
          alteracoesExtras: e.arte.alteracoesExtras,
          nomesIndividuais: e.arte.nomesIndividuais,
        }
      : null,
    provisorio: e.provisorio,
  };
}

/** "1 h 25 min", "42 min" ou "—" quando o tempo não pôde ser estimado. */
export function tempoEmTexto(minutos: number | null): string {
  if (minutos == null || !Number.isFinite(minutos)) return "—";
  const total = Math.round(minutos);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
