/**
 * Para onde o login devolve a pessoa depois da senha.
 *
 * Quem abre um link do sistema sem estar logado — o QR da TV da Oficina lido
 * pela câmera do celular é o caso que fez isto nascer: a câmera abre o Safari,
 * que não divide sessão com o app instalado — era mandado ao login e, depois
 * da senha, caía sempre no Início. O link se perdia no caminho, e com ele o
 * código da TV que estava esperando aprovação.
 *
 * O guarda das telas logadas agora leva o destino até o login (`?destino=`), e
 * o login volta para ele. Este arquivo decide o que pode ser destino.
 *
 * A REGRA: só caminho DESTE site. O valor vem da URL, que qualquer um monta;
 * um login que obedece `?destino=https://outro.site` vira a isca perfeita —
 * endereço verdadeiro, senha verdadeira, e a pessoa termina num site falso
 * pedindo a senha de novo.
 */

/** Só serve para o `URL` conseguir ler um caminho; nunca é visitado. */
const BASE = "http://interno.invalid";

/** Voltar para uma destas depois de entrar seria um laço. */
const TELAS_DE_ENTRADA = ["/login", "/signup", "/reset-password"];

/** Onde o login já cai sozinho: não precisa ir na URL. */
const DESTINO_PADRAO = ["/", "/dashboard", "/dashboard/"];

const TAMANHO_MAXIMO = 512;

/**
 * Devolve o caminho (com busca e âncora) se ele for interno, ou `null`.
 * Recebe `unknown` porque é chamado com o que veio da URL.
 */
export function destinoInterno(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  if (valor.length === 0 || valor.length > TAMANHO_MAXIMO) return null;
  // Uma barra só no começo. "//outro.site" e "/\outro.site" o navegador lê
  // como endereço de outro site.
  if (!/^\/(?![/\\])/.test(valor)) return null;
  // Barra invertida e caractere de controle não existem em caminho nosso, e
  // são o que os truques de redirecionamento usam.
  for (let i = 0; i < valor.length; i++) {
    const c = valor.charCodeAt(i);
    if (c === 92 /* \ */ || c < 32 || c === 127) return null;
  }

  let url: URL;
  try {
    url = new URL(valor, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;

  const caminho = url.pathname;
  if (TELAS_DE_ENTRADA.some((tela) => caminho === tela || caminho.startsWith(`${tela}/`))) {
    return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * O que o guarda põe em `?destino=` ao mandar alguém para o login. Igual a
 * `destinoInterno`, menos o Início: é para lá que o login já vai, e o endereço
 * do login de todo dia não precisa carregar isso.
 */
export function destinoParaLevarAoLogin(href: unknown): string | null {
  const destino = destinoInterno(href);
  if (destino === null) return null;
  const caminho = destino.split(/[?#]/)[0];
  return DESTINO_PADRAO.includes(caminho) ? null : destino;
}
