/**
 * A FICHA CONTRA O MODELO E O CADASTRO (22/11/2026). Função pura: sem banco, sem React e SEM PREÇO.
 *
 * A ficha lida (`ficha-lida.ts`) diz o que o projeto pede. A calculadora só sabe cotar os modelos cadastrados. Este arquivo
 * diz, em frases, onde os dois divergem, para quem orça RESOLVER: material que não está no cadastro, peça que o modelo não
 * tem, quantidade diferente, altura fora do que a calculadora aceita. Não exige estoque (o dono decidiu que dá para
 * orçar sem a chapa) e não recusa material fora do cadastro: aponta.
 *
 * O que NÃO faz: não troca o preço. O preço continua sendo o do modelo escolhido; toda peça da ficha que o modelo não
 * cobre aparece como "o preço não inclui esta peça".
 */
import type { Decoracao, LinhaDoTrofeu } from "./conta";
import type { FichaLida, PecaLida } from "./ficha-lida";
import type { EscolhasDaTela } from "./tela";

export type MaterialDoCadastro = { nome: string; espessuraMm: number | null };

export type PecaDoModeloParaComparar = {
  nome: string;
  /** O nome do material no cadastro. */
  material: string;
  espessuraMm: number;
  larguraCm: number;
  alturaCm: number;
  quantidade: number;
  decoracao: Decoracao;
};

export type ModeloParaComparar = {
  id: string;
  nome: string;
  linha: LinhaDoTrofeu;
  alturaReferenciaCm: number;
  pecas: PecaDoModeloParaComparar[];
};

/** O que a tela precisa para comparar sem voltar ao servidor: só nomes e medidas, nunca custo. */
export type CatalogoParaFicha = {
  modelos: ModeloParaComparar[];
  materiais: MaterialDoCadastro[];
  alturaMinimaCm: number;
  alturaMaximaCm: number;
  espessuraMaximaDeCorteMm: number;
};

export type NivelDaDivergencia = "impede" | "atencao" | "info";
export type Divergencia = { nivel: NivelDaDivergencia; texto: string };

const semAcento = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const FAMILIAS: [string, RegExp][] = [
  ["dourado", /dourad|ouro|gold/],
  ["prata", /prata|silver|alumin/],
  ["cristal", /cristal|transparente|incolor/],
  ["preto", /preto|black/],
  ["branco", /branco|white/],
  ["vermelho", /vermelh|red\b/],
  ["azul", /azul|blue/],
  ["verde", /verde|green/],
  ["amarelo", /amarel|yellow/],
  ["fume", /fume|smoke/],
  ["espelhado", /espelh|mirror/],
];

/** A cor ou o tipo do acrílico, sem ligar para marca, "virgem" ou acento: é com isto que ficha e cadastro se encontram. */
export function familiaDoMaterial(texto: string | null | undefined): string | null {
  const t = semAcento(String(texto ?? ""));
  for (const [familia, regra] of FAMILIAS) if (regra.test(t)) return familia;
  return null;
}

const mesmaEspessura = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 0.05;

const PALAVRAS_GENERICAS = new Set(["base", "placa", "peca", "pecas", "acrilico", "parte", "camada", "camadas"]);

/** As palavras que identificam uma peça pelo nome ("Aro decorativo" → decorativo), sem as genéricas. */
function palavrasDoNome(nome: string): string[] {
  return semAcento(nome)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !PALAVRAS_GENERICAS.has(t));
}

const dividemPalavra = (a: string, b: string) => {
  const pb = new Set(palavrasDoNome(b));
  return palavrasDoNome(a).some((t) => pb.has(t));
};
const emMm = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const emCm = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

export type EstadoDoMaterial =
  | { estado: "nao_informado" }
  | { estado: "cadastrado"; nome: string }
  | { estado: "outra_espessura"; opcoes: string[] }
  | { estado: "sem_cadastro" };

/**
 * O material da ficha no cadastro: mesma cor/tipo e mesma espessura. Se a cor existe só em outra espessura, diz quais.
 * Nada disto olha estoque.
 */
export function acharMaterial(material: string | null, espessuraMm: number | null, cadastro: MaterialDoCadastro[]): EstadoDoMaterial {
  if (material == null || material.trim() === "") return { estado: "nao_informado" };
  const familia = familiaDoMaterial(material);
  if (!familia) return { estado: "sem_cadastro" };
  const doMesmoTipo = cadastro.filter((c) => familiaDoMaterial(c.nome) === familia);
  if (doMesmoTipo.length === 0) return { estado: "sem_cadastro" };
  const palavraDaFicha = semAcento(material);
  const naEspessura = doMesmoTipo
    .filter((c) => mesmaEspessura(c.espessuraMm, espessuraMm))
    // "cristal" na ficha prefere "CRISTAL" no cadastro a "TRANSPARENTE": a primeira palavra da família que a ficha usou.
    .sort((a, b) => Number(palavraDaFicha.includes("cristal") && semAcento(b.nome).includes("cristal")) - Number(palavraDaFicha.includes("cristal") && semAcento(a.nome).includes("cristal")));
  if (naEspessura.length > 0) return { estado: "cadastrado", nome: naEspessura[0].nome };
  if (espessuraMm == null) return { estado: "cadastrado", nome: doMesmoTipo[0].nome };
  const opcoes = [...new Set(doMesmoTipo.filter((c) => c.espessuraMm != null).map((c) => `${emMm(c.espessuraMm as number)} mm`))];
  return { estado: "outra_espessura", opcoes };
}

/** O nome sem acento, maiúscula nem pontuação, para comparar "JariCross 10 Anos" com "Jari Cross - 10 anos". */
const nomeParaComparar = (t: string) => semAcento(t).replace(/[^a-z0-9]+/g, "");

/**
 * O modelo que a ficha parece pedir. Primeiro pelo NOME que a ficha escreve no título ("JariCross 10 Anos"): se há um modelo
 * cadastrado com esse nome, é ele, seja qual for a linha. Sem nome que case, pela linha; sem linha, pelo número de peças.
 */
export function modeloSugerido(ficha: FichaLida, modelos: ModeloParaComparar[]): string | null {
  if (ficha.modeloNome) {
    const alvo = nomeParaComparar(ficha.modeloNome);
    if (alvo.length >= 4) {
      const igual = modelos.find((m) => nomeParaComparar(m.nome) === alvo);
      if (igual) return igual.id;
      // um nome contém o outro ("Troféu JariCross 10 Anos" e "JariCross 10 Anos"), mas só se for um só candidato
      const parecidos = modelos.filter((m) => {
        const n = nomeParaComparar(m.nome);
        return n.length >= 4 && (n.includes(alvo) || alvo.includes(n));
      });
      if (parecidos.length === 1) return parecidos[0].id;
    }
  }
  if (ficha.linha) {
    const achado = modelos.find((m) => m.linha === ficha.linha);
    if (achado) return achado.id;
  }
  const n = ficha.pecas.reduce((s, p) => s + p.quantidade, 0);
  if (n === 0) return null;
  const linha: LinhaDoTrofeu = n <= 3 ? "economico" : n <= 6 ? "padrao" : "premium";
  return modelos.find((m) => m.linha === linha)?.id ?? null;
}

/** Os campos da calculadora que a ficha preenche. Só o que a ficha trouxe: nada é apagado. */
export function escolhasDaFicha(ficha: FichaLida, modeloId: string | null): Partial<EscolhasDaTela> {
  const parte: Partial<EscolhasDaTela> = {};
  if (modeloId) parte.modeloId = modeloId;
  if (ficha.alturaCm != null) parte.alturaTexto = String(ficha.alturaCm).replace(".", ",");
  if (ficha.quantidade != null) parte.quantidadeTexto = String(ficha.quantidade);
  if (ficha.urgente != null) parte.urgente = ficha.urgente;
  if (ficha.arte) parte.arteTipo = ficha.arte;
  if (ficha.nomesIndividuais != null) parte.nomesTexto = String(ficha.nomesIndividuais);
  return parte;
}

const MAQUINAS_QUE_NAO_EXISTEM: [RegExp, string][] = [
  [/router|fresa/, "fresa (CNC router)"],
  [/fibra|fiber/, "laser de fibra"],
  [/\buv\b|dtf/, "impressão UV/DTF"],
];

/** A ficha cita máquina que a casa não usa para isto? Só avisa: a conta é a do laser CO2 e da plotter. */
export function avisosDeMaquina(ficha: FichaLida): string[] {
  const texto = semAcento([...ficha.pecas.map((p) => p.maquina ?? ""), ficha.observacoes ?? ""].join(" | "));
  return MAQUINAS_QUE_NAO_EXISTEM.filter(([regra]) => regra.test(texto)).map(
    ([, nome]) => `A ficha cita ${nome}. Na casa o acrílico é cortado e gravado no laser CO2 e impresso em vinil laminado na plotter; confira com a produção.`,
  );
}

const peso: Record<NivelDaDivergencia, number> = { impede: 0, atencao: 1, info: 2 };

function descreve(p: PecaLida, soMaterial = false): string {
  const partes = [p.material, p.espessuraMm != null ? `${emMm(p.espessuraMm)} mm` : null].filter(Boolean);
  if (soMaterial) return p.material && p.espessuraMm != null ? `${p.material} de ${emMm(p.espessuraMm)} mm` : partes.join(", ") || "material não informado";
  return partes.length ? `${p.nome} (${partes.join(", ")})` : p.nome;
}

/**
 * Onde a ficha e o modelo escolhido não batem. Lista vazia quer dizer que cabem. A conta continua sendo a do modelo.
 */
export function compararFichaComModelo(ficha: FichaLida, modelo: ModeloParaComparar | null, catalogo: CatalogoParaFicha): Divergencia[] {
  const saida: Divergencia[] = [];
  const poe = (nivel: NivelDaDivergencia, texto: string) => saida.push({ nivel, texto });

  if (ficha.alturaCm != null && (ficha.alturaCm < catalogo.alturaMinimaCm || ficha.alturaCm > catalogo.alturaMaximaCm)) {
    poe("impede", `A ficha pede ${emCm(ficha.alturaCm)} cm de altura; a calculadora vai de ${emCm(catalogo.alturaMinimaCm)} a ${emCm(catalogo.alturaMaximaCm)} cm.`);
  }
  if (ficha.quantidade != null && ficha.nomesIndividuais != null && ficha.nomesIndividuais > ficha.quantidade) {
    poe("atencao", "A ficha tem mais nomes individuais do que troféus: confira os dois números.");
  }
  if (!modelo) {
    if (ficha.pecas.length > 0) poe("info", "Escolha o modelo para ver o que a ficha tem a mais ou a menos que ele.");
  } else {
    const fator = (ficha.alturaCm ?? modelo.alturaReferenciaCm) / modelo.alturaReferenciaCm;
    const livres = modelo.pecas.map((p) => ({ ...p, restante: p.quantidade }));

    for (const peca of ficha.pecas) {
      const familia = familiaDoMaterial(peca.material);
      const iguais =
        peca.espessuraMm != null && familia
          ? livres.filter((m) => m.restante > 0 && mesmaEspessura(m.espessuraMm, peca.espessuraMm) && familiaDoMaterial(m.material) === familia)
          : [];
      // Entre as peças de mesmo material e espessura, a de nome parecido primeiro: a ordem do cadastro é só o desempate.
      const par = iguais.find((m) => dividemPalavra(m.nome, peca.nome)) ?? iguais[0];
      if (par) {
        const usadas = Math.min(par.restante, peca.quantidade);
        par.restante -= usadas;
        if (peca.quantidade !== par.quantidade) {
          poe("atencao", `A ficha pede ${peca.quantidade} de "${peca.nome}" por troféu; o modelo tem ${par.quantidade}. O preço é o do modelo.`);
        }
        const esperadaL = par.larguraCm * fator;
        const esperadaA = par.alturaCm * fator;
        const fora = (lido: number | null, esperado: number) => lido != null && Math.abs(lido - esperado) / esperado > 0.25;
        if (fora(peca.larguraCm, esperadaL) || fora(peca.alturaCm, esperadaA)) {
          poe(
            "info",
            `"${peca.nome}": a ficha traz ${emCm(peca.larguraCm ?? 0)} × ${emCm(peca.alturaCm ?? 0)} cm; o modelo, nesta altura, usa ${emCm(esperadaL)} × ${emCm(esperadaA)} cm.`,
          );
        }
        continue;
      }
      // Mesma peça pelo nome, mas em outro material ou espessura: UMA frase, e a peça do modelo sai da lista de "faltando".
      const parDeNome = livres.find((m) => m.restante > 0 && dividemPalavra(m.nome, peca.nome));
      if (parDeNome) {
        parDeNome.restante -= Math.min(parDeNome.restante, peca.quantidade);
        poe("atencao", `"${peca.nome}": a ficha pede ${descreve(peca, true)}; o modelo usa "${parDeNome.material}". O preço é o do modelo.`);
        continue;
      }
      if (peca.material == null || peca.espessuraMm == null) {
        poe("info", `A ficha não diz ${peca.material == null ? "o material" : "a espessura"} de "${peca.nome}": não deu para conferir.`);
        continue;
      }
      const achado = acharMaterial(peca.material, peca.espessuraMm, catalogo.materiais);
      const base = `A ficha tem "${descreve(peca)}", que o modelo "${modelo.nome}" não tem: o preço não inclui esta peça.`;
      if (achado.estado === "sem_cadastro") poe("atencao", `${base} O material não está no cadastro: cadastre-o para o custo entrar na conta.`);
      else if (achado.estado === "outra_espessura") poe("atencao", `${base} No cadastro esse material existe só em ${achado.opcoes.join(", ")}.`);
      else poe("atencao", `${base} O material já está no cadastro.`);
    }

    for (const sobra of livres.filter((m) => m.restante > 0)) {
      if (ficha.pecas.length === 0) break;
      poe("info", `O modelo tem "${sobra.nome}" (${sobra.restante}) que a ficha não mostra; o preço inclui.`);
    }
  }

  for (const peca of ficha.pecas) {
    if (peca.espessuraMm != null && peca.espessuraMm > catalogo.espessuraMaximaDeCorteMm) {
      poe("atencao", `"${peca.nome}" tem ${emMm(peca.espessuraMm)} mm; o laser da casa corta até ${emMm(catalogo.espessuraMaximaDeCorteMm)} mm (corte de fora ou outro processo).`);
    }
  }
  for (const frase of avisosDeMaquina(ficha)) poe("info", frase);

  return saida.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
}
