/**
 * A TELA DE "COTAR AS PEÇAS DA FICHA" (26/11/2026): as linhas editáveis e a conversão para o que o servidor recebe.
 * Função pura: sem React, sem banco, sem rede e SEM PREÇO. O preço é do servidor (`cotarFichaSobMedida`).
 *
 * A ficha lida (`ficha-lida.ts`) traz as peças com o material como a ficha o escreveu. Aqui cada peça vira uma linha de
 * texto (é o que um campo digita), já com o material do CADASTRO sugerido quando existe um igual (mesma cor e mesma
 * espessura). Se não existe, a linha fica sem material e a pessoa escolhe um da MESMA espessura: o custo do m² é do
 * material naquela espessura (`sob-medida.ts`). Nada exige estoque.
 */
import type { Decoracao } from "./conta";
import { acharMaterial, type CatalogoParaFicha } from "./ficha-comparar";
import type { FichaLida } from "./ficha-lida";
import { conferirPecasSobMedida, materiaisCompativeis, type PecaSobMedida } from "./sob-medida";

export type LinhaDaTela = {
  /** Estável entre as edições (o índice da peça na ficha). */
  chave: string;
  nome: string;
  /** O que a ficha escreveu como material ("Acrílico prata escovado"). Nulo quando não escreveu. */
  materialDaFicha: string | null;
  /** O id do material do cadastro que bate com a ficha (mesma cor e espessura). Vazio quando não há. */
  materialSugeridoId: string;
  /** O que a pessoa escolheu. Vazio = ainda não escolheu. */
  materialId: string;
  /** Texto do campo: aceita vírgula. */
  espessura: string;
  largura: string;
  altura: string;
  quantidade: string;
  decoracao: Decoracao;
  fatorDeForma: string;
};

/** "6", "6,5" e "6.5" viram número; vazio e texto viram NaN (a conferência diz o que falta). */
export function numeroDoCampo(texto: string): number {
  const t = String(texto ?? "")
    .trim()
    .replace(",", ".");
  if (t === "") return Number.NaN;
  return Number(t);
}

const comoCampo = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "" : String(Math.round(n * 100) / 100).replace(".", ",");

/** As linhas iniciais da tela, vindas da ficha lida e do catálogo (nomes, medidas e ids; nunca custo). */
export function linhasDaFicha(ficha: FichaLida, catalogo: CatalogoParaFicha): LinhaDaTela[] {
  return ficha.pecas.map((p, i) => {
    const estado = acharMaterial(p.material, p.espessuraMm, catalogo.materiais);
    const sugerido =
      estado.estado === "cadastrado"
        ? (catalogo.materiais.find(
            (m) =>
              m.nome === estado.nome &&
              typeof m.id === "string" &&
              m.id !== "" &&
              (m.unidade == null || m.unidade === "m²"),
          )?.id ?? "")
        : "";
    return {
      chave: String(i),
      nome: p.nome,
      materialDaFicha: p.material,
      materialSugeridoId: sugerido,
      materialId: sugerido,
      espessura: comoCampo(p.espessuraMm),
      largura: comoCampo(p.larguraCm),
      altura: comoCampo(p.alturaCm),
      quantidade: String(p.quantidade ?? 1),
      decoracao: p.decoracao ?? "nenhuma",
      fatorDeForma: "1",
    };
  });
}

/**
 * A linha como o servidor a recebe. O `materialPedido` só vai quando a pessoa escolheu um material DIFERENTE do que a
 * ficha pedia (ou a ficha pedia um e o cadastro não tem): é o que faz o aviso "cotada com X no lugar de Y" aparecer.
 */
export function pecaDaLinha(l: LinhaDaTela): PecaSobMedida {
  const trocou =
    l.materialDaFicha != null &&
    l.materialDaFicha.trim() !== "" &&
    l.materialId !== l.materialSugeridoId;
  return {
    nome: l.nome,
    materialId: l.materialId,
    espessuraMm: numeroDoCampo(l.espessura),
    larguraCm: numeroDoCampo(l.largura),
    alturaCm: numeroDoCampo(l.altura),
    quantidade: numeroDoCampo(l.quantidade),
    decoracao: l.decoracao,
    fatorDeForma: numeroDoCampo(l.fatorDeForma),
    materialPedido: trocou ? l.materialDaFicha!.trim() : null,
  };
}

/** Ao mudar a espessura, o material escolhido só continua se for da mesma espessura. */
export function aoMudarAEspessura(
  l: LinhaDaTela,
  espessura: string,
  catalogo: CatalogoParaFicha,
): LinhaDaTela {
  const mm = numeroDoCampo(espessura);
  const compativeis = materiaisCompativeis(mm, catalogo.materiais);
  const continua = compativeis.some((m) => m.id === l.materialId);
  return { ...l, espessura, materialId: continua ? l.materialId : "" };
}

export type PedidoDaTela = {
  alturaCm: number;
  quantidade: number;
  urgente: boolean;
  pecas: PecaSobMedida[];
};

export const SEM_ALTURA = "Informe a altura do troféu (em cm) para cotar.";
export const SEM_QUANTIDADE = "Informe a quantidade de troféus, em número inteiro.";

/** O pedido para o servidor, ou a primeira frase do que falta preencher. Nada de preço. */
export function pedidoDaTela(
  linhas: LinhaDaTela[],
  altura: string,
  quantidade: string,
  urgente: boolean,
): { ok: true; pedido: PedidoDaTela } | { ok: false; problema: string } {
  const alturaCm = numeroDoCampo(altura);
  if (!Number.isFinite(alturaCm) || alturaCm <= 0) return { ok: false, problema: SEM_ALTURA };
  const qtd = numeroDoCampo(quantidade);
  if (!Number.isInteger(qtd) || qtd < 1) return { ok: false, problema: SEM_QUANTIDADE };
  const pecas = linhas.map(pecaDaLinha);
  const problema = conferirPecasSobMedida(pecas);
  if (problema) return { ok: false, problema };
  return { ok: true, pedido: { alturaCm, quantidade: qtd, urgente, pecas } };
}
