// Converte o nome da cor de um filamento (texto livre em PT-BR) numa amostra visual.
export type AmostraCor = { chave: string; nome: string; css: string };

const CORES: Array<{ chave: string; nome: string; css: string; palavras: string[] }> = [
  { chave: "multicor", nome: "Multicor", css: "linear-gradient(135deg,#8e44ad,#5dade2,#f4d03f)", palavras: ["tricolor", "multicor", "arco"] },
  { chave: "dourado", nome: "Dourado", css: "#c9a227", palavras: ["dourad", "ouro"] },
  { chave: "prata", nome: "Prata", css: "#b8bec6", palavras: ["prata", "silver"] },
  { chave: "lilas", nome: "Lilás", css: "#b48ad8", palavras: ["lilas", "roxo", "violeta"] },
  { chave: "ciano", nome: "Ciano", css: "#00a9c6", palavras: ["ciano", "cyan"] },
  { chave: "azul", nome: "Azul", css: "#2f6fd6", palavras: ["azul", "blue"] },
  { chave: "verde", nome: "Verde", css: "#3a9d4a", palavras: ["verde", "green"] },
  { chave: "amarelo", nome: "Amarelo", css: "#f2c94c", palavras: ["amarel", "sunflower", "yellow"] },
  { chave: "laranja", nome: "Laranja", css: "#f2994a", palavras: ["laranja", "orange"] },
  { chave: "rosa", nome: "Rosa", css: "#e32686", palavras: ["rosa", "pink", "magenta"] },
  { chave: "vermelho", nome: "Vermelho", css: "#d63a3a", palavras: ["vermelh", "marsala", "red"] },
  { chave: "marrom", nome: "Marrom", css: "#8b5a2b", palavras: ["marrom", "madeira", "brown"] },
  { chave: "cinza", nome: "Cinza", css: "#8a9099", palavras: ["cinza", "grafite", "gray", "grey"] },
  { chave: "preto", nome: "Preto", css: "#1c1f24", palavras: ["preto", "black"] },
  { chave: "natural", nome: "Natural", css: "#efe6d2", palavras: ["natural", "transparente"] },
  { chave: "branco", nome: "Branco", css: "#ffffff", palavras: ["branco", "white"] },
];

const NEUTRA: AmostraCor = { chave: "outra", nome: "Outra", css: "repeating-linear-gradient(45deg,#ccc 0 3px,#eee 3px 6px)" };

function normalizar(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function amostraDaCor(...textos: Array<string | null | undefined>): AmostraCor {
  const t = normalizar(textos.filter(Boolean).join(" "));
  if (!t) return NEUTRA;
  const achada = CORES.find((c) => c.palavras.some((p) => t.includes(p)));
  return achada ? { chave: achada.chave, nome: achada.nome, css: achada.css } : NEUTRA;
}
