/**
 * O pareamento da TV da Oficina: código, crachá e "sem acesso há X".
 *
 * A TV fica na parede, sem teclado e sem login. Para ler o painel ela precisa
 * de um crachá (o token do aparelho), e quem entrega o crachá é alguém logado
 * como admin ou gestor, que digita — ou lê pelo QR — o CÓDIGO que a TV mostra.
 *
 * Três coisas diferentes circulam, e confundi-las é o defeito:
 *   código    6 caracteres, aparece na parede, qualquer um na oficina lê.
 *             Sozinho não abre nada: só serve para o admin apontar QUAL pedido
 *             está aprovando.
 *   retirada  segredo que só a TV que pediu conhece. É o que impede outra tela
 *             de buscar o crachá de um pedido que ela viu na parede.
 *   token     o crachá. O servidor o deriva do segredo de retirada na hora
 *             em que a TV vem buscar, e o banco guarda só o SHA-256 dele. Por
 *             ser derivado, a mesma TV com o mesmo pedido recebe sempre o
 *             mesmo: resposta perdida no Wi-Fi não deixa a TV sem crachá.
 *
 * Este arquivo é domínio puro: não fala com banco nem com rede. As regras de
 * formato daqui são as mesmas dos CHECK das tabelas `tv_pareamentos` e
 * `tv_dispositivos` — mudou lá, muda aqui.
 */

/**
 * Alfabeto do código: 32 caracteres, sem I, O, 0 e 1. Lido de longe numa TV,
 * "O" e "0" são o mesmo desenho, e quem erra o código três vezes desiste.
 * 32 também é 2^5: cada byte aleatório vira um caractere sem sobra, então o
 * sorteio não favorece nenhuma letra.
 */
export const ALFABETO_DO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const TAMANHO_DO_CODIGO = 6;
/** Mesmo valor do default de `tv_pareamentos.expira_em`. */
export const VALIDADE_DO_PAREAMENTO_MIN = 10;
/** Teto de pareamentos vivos ao mesmo tempo (`tv_criar_pareamento`). */
export const TETO_DE_PAREAMENTOS = 20;
/** Teto de pareamentos vivos pedidos do mesmo endereço (`tv_criar_pareamento_da_origem`). */
export const TETO_POR_ORIGEM = 5;
export const TAMANHO_MAXIMO_DO_NOME = 40;

/** O token viaja neste cabeçalho — nunca na URL, que fica em log e histórico. */
export const CABECALHO_DO_TOKEN = "x-tv-token";
/** Onde a TV guarda o crachá: mesma chave no localStorage e no cookie. */
export const CHAVE_DO_TOKEN = "bexprint_tv_token";
/** Onde a TV guarda o pedido em andamento, para não abrir outro a cada recarga. */
export const CHAVE_DO_PAREAMENTO = "bexprint_tv_pareamento";

export const ROTA_DE_PAREAMENTO = "/api/tv/parear";
export const ROTA_DO_PAINEL = "/api/tv/painel";
/** A tela logada onde admin e gestor aprovam, listam e revogam. */
export const ROTA_DAS_TELAS = "/telas";

const FORMATO_DO_CODIGO = /^[A-HJ-NP-Z2-9]{6}$/;
/** 32 bytes em base64url, sem preenchimento: sempre 43 caracteres. */
const FORMATO_DO_SEGREDO = /^[A-Za-z0-9_-]{43}$/;
const FORMATO_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sorteia o código. Recebe os bytes de fora nos testes; em uso, vêm do
 * `crypto.getRandomValues`, que existe no navegador, no Worker e no Node.
 */
export function gerarCodigo(bytes?: Uint8Array): string {
  const fonte = bytes ?? crypto.getRandomValues(new Uint8Array(TAMANHO_DO_CODIGO));
  if (fonte.length < TAMANHO_DO_CODIGO) {
    throw new Error(`o código precisa de ${TAMANHO_DO_CODIGO} bytes aleatórios`);
  }
  let codigo = "";
  for (let i = 0; i < TAMANHO_DO_CODIGO; i++) codigo += ALFABETO_DO_CODIGO[fonte[i] & 31];
  return codigo;
}

/**
 * O que a pessoa digitou → o que o banco compara. Aceita minúscula, espaço e o
 * hífen do meio; NÃO troca "0" por "O": código com caractere fora do alfabeto
 * é código errado, e adivinhar a intenção viraria aprovar a TV errada.
 * A função do banco aplica a mesma limpeza.
 */
export function normalizarCodigo(texto: string): string {
  return texto.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function codigoValido(codigo: string): boolean {
  return FORMATO_DO_CODIGO.test(codigo);
}

/** "K7MQ2X" → "K7M-Q2X": dois grupos de três se leem e se ditam melhor. */
export function formatarCodigo(codigo: string): string {
  const limpo = normalizarCodigo(codigo);
  return limpo.length > 3 ? `${limpo.slice(0, 3)}-${limpo.slice(3, TAMANHO_DO_CODIGO)}` : limpo;
}

/**
 * O endereço que vai no QR da TV. Leva SÓ o código — que já está escrito na
 * parede — até a tela logada. Quem não está logado passa pelo login e volta
 * para cá; quem está e não é admin nem gestor vê a tela dizer que não pode.
 *
 * O código vai como `codigoNaUrl` o escreve ("234_E56"), nunca cru.
 */
export function urlDeAprovacao(origem: string, codigo: string): string {
  return `${origem.replace(/\/+$/, "")}${ROTA_DAS_TELAS}?codigo=${codigoNaUrl(codigo)}`;
}

/**
 * O código do jeito que viaja na URL: "K7M_Q2X", com SUBLINHADO no meio.
 *
 * Não é enfeite. O roteador passa cada valor da URL por JSON.parse, e código
 * também é feito de dígitos e da letra E:
 *   "234E56"   é número em notação científica — chegava à tela como "234E58";
 *   "22E-222"  com o hífen de exibição também é número (expoente negativo) —
 *              chegava como "22E221".
 * Nos dois casos a tela mostrava OUTRO código, bem formado, e quem aprovasse
 * gastava uma tentativa com "código não encontrado". Sublinhado não existe em
 * nenhum valor JSON: com ele o código chega como texto, sempre. E por nunca
 * ser JSON, é também a forma que o roteador escreveria — o servidor não
 * redireciona o endereço do QR para outra grafia.
 */
export function codigoNaUrl(codigo: string): string {
  const limpo = normalizarCodigo(codigo).slice(0, TAMANHO_DO_CODIGO);
  return limpo.length > 3 ? `${limpo.slice(0, 3)}_${limpo.slice(3)}` : limpo;
}

/**
 * O `?codigo=` de /telas, do jeito que o roteador entrega, de volta à grafia
 * da URL ("K7M_Q2X"). É o `validateSearch` da rota, aqui para poder ser
 * testado. Para mostrar no campo, passe por `formatarCodigo`.
 *
 * Devolve a MESMA grafia do QR porque o servidor redireciona para a forma que
 * o validador devolve: devolvendo outra, o endereço seria reescrito a cada
 * leitura. Quem chama tem de gravar a chave mesmo quando vem `undefined` — o
 * roteador junta o valor cru com o validado, e um `?codigo=true` cru chegaria
 * à tela como booleano.
 */
export function codigoDaBusca(cru: unknown): string | undefined {
  const texto = typeof cru === "string" || typeof cru === "number" ? String(cru) : "";
  return codigoNaUrl(texto) || undefined;
}

/** Token do aparelho e segredo de retirada têm o mesmo formato (`gerarSegredo`). */
export function segredoBemFormado(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_DO_SEGREDO.test(valor);
}

export function idBemFormado(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_DE_UUID.test(valor);
}

/** Nome da TV como o banco grava: espaços nas pontas fora, repetidos viram um. */
export function normalizarNome(nome: string): string {
  return nome.replace(/\s+/g, " ").trim();
}

export function nomeValido(nome: string): boolean {
  const limpo = normalizarNome(nome);
  return limpo.length >= 1 && limpo.length <= TAMANHO_MAXIMO_DO_NOME;
}

/* ------------------------------------------------------------------------- */
/* O pedido visto pela TV                                                     */
/* ------------------------------------------------------------------------- */

/**
 * O que `POST /api/tv/parear {acao:"novo"}` devolve e a TV guarda em
 * `localStorage[CHAVE_DO_PAREAMENTO]`. `retirada` nunca aparece na tela.
 */
export type PedidoDePareamento = {
  pareamento_id: string;
  codigo: string;
  retirada: string;
  expira_em: string;
  /** Segundos que faltam, pelo relógio do banco, na hora da resposta. */
  validade_s: number;
};

/**
 * O que `POST /api/tv/parear {acao:"retirar"}` responde no campo `estado`.
 *   aguardando  ninguém aprovou ainda: continue perguntando
 *   pareado     veio o token: guarde e comece a ler o painel. Perguntar de novo
 *               com o mesmo pedido devolve o mesmo token
 *   expirado    o código venceu: peça outro
 *   consumido   o crachá deste pedido foi revogado: peça outro
 */
export type EstadoDaRetirada = "aguardando" | "pareado" | "expirado" | "consumido";

/** Estados em que a TV tem de jogar o pedido fora e abrir um novo. */
export function retiradaPedeNovoCodigo(estado: EstadoDaRetirada): boolean {
  return estado === "expirado" || estado === "consumido";
}

/**
 * Quanto falta para o código vencer, para a contagem que a TV mostra.
 *
 * Quem diz que o pedido venceu é o SERVIDOR (estado "expirado"), nunca esta
 * conta: a TV reaproveita o pedido guardado e pergunta. Comparar `expira_em`
 * com o relógio do aparelho foi o primeiro desenho, e mini PC com a hora
 * adiantada 11 minutos via todo código recém-criado como vencido, pedia outro
 * em laço e enchia sozinho a fila de pareamento.
 *
 * Por isso a conta é de CRONÔMETRO: `validade_s` veio do banco, e `decorridoMs`
 * é quanto o aparelho mediu desde que a resposta chegou (`performance.now()`
 * depois menos antes). Hora errada não entra.
 */
export function segundosRestantes(validadeS: number, decorridoMs: number): number {
  if (!Number.isFinite(validadeS) || !Number.isFinite(decorridoMs)) return 0;
  return Math.max(0, Math.floor(validadeS - Math.max(0, decorridoMs) / 1000));
}

/* ------------------------------------------------------------------------- */
/* A aprovação vista por quem está logado                                     */
/* ------------------------------------------------------------------------- */

/** Os motivos que `tv_aprovar_pareamento` devolve em `{ok:false, motivo}`. */
export type MotivoDaRecusa =
  | "nome_invalido"
  | "muitas_tentativas"
  | "codigo_mal_formado"
  | "codigo_nao_encontrado"
  | "codigo_ja_usado"
  | "codigo_expirado";

export type RespostaDaAprovacao =
  | { ok: true; nome: string }
  | { ok: false; motivo: MotivoDaRecusa; tentativas_restantes?: number; liberado_em?: string };

function horaLocal(iso: string | undefined): string | null {
  if (!iso) return null;
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return null;
  // A oficina é em Macapá; o navegador de quem aprova pode estar em outro fuso.
  return quando.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Belem",
  });
}

/**
 * A frase que a tela mostra para cada recusa. Cada uma diz o que fazer — "não
 * foi possível" não ajuda quem está de pé na frente da TV com o celular.
 */
export function mensagemDaRecusa(resposta: Extract<RespostaDaAprovacao, { ok: false }>): string {
  switch (resposta.motivo) {
    case "nome_invalido":
      return `Dê um nome à TV, com até ${TAMANHO_MAXIMO_DO_NOME} letras.`;
    case "muitas_tentativas": {
      const hora = horaLocal(resposta.liberado_em);
      return hora
        ? `Muitos códigos errados seguidos. Por segurança, tente de novo depois das ${hora}.`
        : "Muitos códigos errados seguidos. Por segurança, espere alguns minutos.";
    }
    case "codigo_mal_formado":
      return `O código tem ${TAMANHO_DO_CODIGO} letras e números, como aparece na TV. Não existe 0, 1, I nem O nele.`;
    case "codigo_nao_encontrado": {
      const restam = resposta.tentativas_restantes;
      if (restam === undefined) return "Código não encontrado. Confira na TV e digite de novo.";
      if (restam <= 0)
        return "Código não encontrado. Foi a última tentativa por agora: espere 10 minutos.";
      return `Código não encontrado. Confira na TV e digite de novo — ${
        restam === 1 ? "resta 1 tentativa" : `restam ${restam} tentativas`
      }.`;
    }
    case "codigo_ja_usado":
      return "Este código já foi aprovado. Se a TV ainda mostra um código, use o que está nela agora.";
    case "codigo_expirado":
      return "Este código venceu. A TV troca de código a cada 10 minutos: use o que está nela agora.";
  }
}

/* ------------------------------------------------------------------------- */
/* A lista de TVs                                                             */
/* ------------------------------------------------------------------------- */

/** Uma linha de `tv_listar_dispositivos().dispositivos`. Sem hash e sem token. */
export type DispositivoDeTv = {
  id: string;
  nome: string;
  /** Como ganhou o crachá: código aprovado aqui, ou o PIN digitado na própria TV. */
  entrada?: "codigo" | "pin";
  criado_em: string;
  criado_por: string | null;
  ultimo_acesso_em: string | null;
  revogado_em: string | null;
  revogado_por: string | null;
};

/** O PIN da TV como /telas o vê: se está ligado e quantos números tem — nunca o PIN. */
export type PinDaTv = {
  ligado: boolean;
  digitos: number | null;
  definido_em: string | null;
  definido_por: string | null;
};

export type ListaDeTvs = {
  /** Relógio do banco na hora da consulta — é contra ele que se mede o "há X". */
  agora: string;
  pareamentos_pendentes: number;
  aprovados_aguardando: { nome: string; aprovado_em: string; expira_em: string }[];
  dispositivos: DispositivoDeTv[];
  pin?: PinDaTv | null;
  /** PINs errados digitados em alguma TV nos últimos 15 minutos. */
  pin_erros_15min?: number;
};

/**
 * A TV lê a cada 60 s e o banco regrava o último acesso no máximo uma vez por
 * minuto, então uma TV ligada aparece com até ~2 min de atraso. Cinco minutos
 * de folga cobrem as duas retentativas da TV sem chamar de "no ar" uma TV que
 * caiu.
 */
export const TOLERANCIA_NO_AR_MS = 5 * 60 * 1000;

export type SituacaoDaTv = "revogada" | "nunca_acessou" | "no_ar" | "sem_acesso";

export function situacaoDaTv(
  tv: Pick<DispositivoDeTv, "ultimo_acesso_em" | "revogado_em">,
  agora: Date,
): SituacaoDaTv {
  if (tv.revogado_em) return "revogada";
  if (!tv.ultimo_acesso_em) return "nunca_acessou";
  const ultimo = Date.parse(tv.ultimo_acesso_em);
  // Data ilegível não pode virar "no ar": na dúvida, a tela acusa.
  if (!Number.isFinite(ultimo)) return "sem_acesso";
  return agora.getTime() - ultimo <= TOLERANCIA_NO_AR_MS ? "no_ar" : "sem_acesso";
}

/** "40 min", "3 h", "2 dias" — o X de "sem acesso há X". */
export function duracaoPorExtenso(ms: number): string {
  const minutos = Math.max(0, Math.floor(ms / 60_000));
  if (minutos < 1) return "menos de 1 min";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas} h`;
  return `${Math.floor(horas / 24)} dias`;
}

/**
 * A frase da coluna "situação". TV de oficina é desligada todo fim de dia e
 * ninguém avisa quando ela apaga: é este texto, lido por quem abre /telas, que
 * conta que a parede está escura.
 */
export function textoDaSituacao(
  tv: Pick<DispositivoDeTv, "ultimo_acesso_em" | "revogado_em">,
  agora: Date,
): string {
  switch (situacaoDaTv(tv, agora)) {
    case "revogada":
      return "Acesso revogado";
    case "nunca_acessou":
      return "Nunca acessou";
    case "no_ar":
      return "No ar";
    case "sem_acesso": {
      const ultimo = Date.parse(tv.ultimo_acesso_em ?? "");
      if (!Number.isFinite(ultimo)) return "Sem acesso";
      return `Sem acesso há ${duracaoPorExtenso(agora.getTime() - ultimo)}`;
    }
  }
}
