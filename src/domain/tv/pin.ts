/**
 * A entrada por PIN da TV da Oficina: o que a TV desenha, o que manda e o que
 * cada resposta quer dizer.
 *
 * A TV mostra um teclado; quem está na frente dela digita o PIN. O PIN certo
 * não abre o painel direto: vira um CRACHÁ para aquela TV (o mesmo das
 * pareadas por código), que ela guarda e usa dali em diante. Quem confere é o
 * banco (`tv_entrar_com_pin`), contra um hash bcrypt — o PIN não existe no
 * pacote do navegador nem no código.
 *
 * O crachá é sorteado pela PRÓPRIA TV e guardado antes de ir ao servidor. Se a
 * resposta "liberado" se perder no Wi-Fi da oficina, a TV repete com o mesmo
 * crachá e o servidor responde "liberado" de novo, sem criar outro aparelho.
 *
 * Domínio puro: não fala com rede nem com storage. As regras de formato daqui
 * são as mesmas das funções `tv_definir_pin` e `tv_entrar_com_pin`.
 */

export const ROTA_DO_PIN = "/api/tv/pin";
/** Onde a TV guarda o crachá sorteado enquanto o servidor não confirma. */
export const CHAVE_DO_TOKEN_PENDENTE = "bexprint_tv_token_pendente";

export const PIN_MINIMO = 4;
export const PIN_MAXIMO = 8;
/** Erros seguidos do mesmo endereço antes de a entrada esperar 15 minutos. */
export const ERROS_ATE_ESPERAR = 5;

const FORMATO_DO_PIN = /^[0-9]{4,8}$/;

export function pinBemFormado(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_DO_PIN.test(valor);
}

/**
 * PIN que qualquer um tenta primeiro: todos os dígitos iguais ("0000") ou em
 * sequência ("1234", "4321"). O freio de 5 erros segura quem chuta às cegas,
 * não quem chuta o óbvio — por isso a tela de quem define o PIN avisa.
 */
export function pinObvio(pin: string): boolean {
  if (!pinBemFormado(pin)) return false;
  const d = [...pin].map(Number);
  const iguais = d.every((x) => x === d[0]);
  const sobe = d.every((x, i) => i === 0 || x === (d[i - 1] + 1) % 10);
  const desce = d.every((x, i) => i === 0 || x === (d[i - 1] + 9) % 10);
  return iguais || sobe || desce;
}

/** O que `GET /api/tv/pin` responde: se a entrada por PIN está ligada e quantas casas desenhar. */
export type EstadoDoPin = { ligado: boolean; digitos: number | null };

/**
 * Lê a resposta do GET sem confiar nela: resposta torta é "não sei", e a TV
 * trata "não sei" mostrando o teclado de 4 casas (o servidor ainda decide
 * tudo no POST).
 */
export function interpretarEstadoDoPin(corpo: unknown): EstadoDoPin | null {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return null;
  const cru = corpo as Record<string, unknown>;
  if (typeof cru.ligado !== "boolean") return null;
  if (!cru.ligado) return { ligado: false, digitos: null };
  const digitos = cru.digitos;
  if (
    typeof digitos !== "number" ||
    !Number.isInteger(digitos) ||
    digitos < PIN_MINIMO ||
    digitos > PIN_MAXIMO
  ) {
    return null;
  }
  return { ligado: true, digitos };
}

/**
 * O que a TV faz com cada resposta de `POST /api/tv/pin`:
 *   liberado        guarda o crachá e começa a ler o painel
 *   pin_errado      limpa as casas e diz quantas tentativas restam
 *   esperar         muitas erradas: espera `s` segundos (cronômetro, nunca a
 *                   hora do aparelho)
 *   usar_codigo     o PIN foi desligado em /telas: vai para o pareamento
 *   trocar_cracha   o crachá guardado foi revogado: sorteia outro e repete
 *   sem_servidor    rede ou servidor fora: avisa e deixa digitar de novo
 */
export type PassoDoPin =
  | { tipo: "liberado"; nome: string }
  | { tipo: "pin_errado"; restantes: number }
  | { tipo: "esperar"; s: number }
  | { tipo: "usar_codigo" }
  | { tipo: "trocar_cracha" }
  | { tipo: "sem_servidor"; detalhe: string };

export function passoDaResposta(
  status: number,
  corpo: unknown,
  retryAfter: number | null,
): PassoDoPin {
  const c =
    corpo && typeof corpo === "object" && !Array.isArray(corpo)
      ? (corpo as Record<string, unknown>)
      : {};
  if (status === 200 && c.estado === "liberado") {
    return { tipo: "liberado", nome: typeof c.nome === "string" ? c.nome : "TV" };
  }
  if (status === 401 && c.erro === "pin_errado") {
    const restantes = Number(c.restantes);
    return { tipo: "pin_errado", restantes: Number.isFinite(restantes) ? Math.max(0, restantes) : 0 };
  }
  if (status === 429) {
    const s = Number(c.libera_s);
    const espera = Number.isFinite(s) && s > 0 ? s : (retryAfter ?? 60);
    return { tipo: "esperar", s: Math.ceil(espera) };
  }
  if (status === 403 && c.erro === "pin_desligado") return { tipo: "usar_codigo" };
  if (status === 409 && c.erro === "token_revogado") return { tipo: "trocar_cracha" };
  if (status === 200) return { tipo: "sem_servidor", detalhe: "resposta fora do contrato" };
  return { tipo: "sem_servidor", detalhe: status === 503 ? "503" : `HTTP ${status}` };
}

/** "14 min", "40 s" — quanto falta para a entrada voltar a aceitar PIN. */
export function esperaPorExtenso(segundos: number): string {
  const s = Math.max(0, Math.ceil(segundos));
  if (s < 60) return `${s} s`;
  return `${Math.ceil(s / 60)} min`;
}

/* ------------------------------------------------------------------------- */
/* O PIN visto por quem o define, em /telas                                   */
/* ------------------------------------------------------------------------- */

/** O que `tv_definir_pin` devolve. */
export type RespostaDoDefinirPin =
  | { ok: true; ligado: boolean; digitos: number | null; igual: boolean; desconectadas: number }
  | { ok: false; motivo: "pin_invalido" };

/** A frase depois de salvar, que diz o que aconteceu com as TVs. */
export function mensagemDoDefinirPin(r: Extract<RespostaDoDefinirPin, { ok: true }>): string {
  if (r.igual) return r.ligado ? "Este já é o PIN da TV. Nada mudou." : "A entrada por PIN já estava desligada.";
  const n = r.desconectadas;
  if (r.ligado) {
    if (n === 0) return "PIN salvo.";
    return n === 1
      ? "PIN salvo. 1 TV que tinha entrado pelo PIN antigo foi desconectada e pede o PIN de novo."
      : `PIN salvo. ${n} TVs que tinham entrado pelo PIN antigo foram desconectadas e pedem o PIN de novo.`;
  }
  const caidas =
    n === 0
      ? ""
      : n === 1
        ? " 1 TV que tinha entrado pelo PIN foi desconectada."
        : ` ${n} TVs que tinham entrado pelo PIN foram desconectadas.`;
  return `Entrada por PIN desligada.${caidas} A TV passa a pedir o código.`;
}

/** A frase do PIN errado, em letra de parede. */
export function textoDoPinErrado(restantes: number): string {
  if (restantes <= 0) return "PIN ERRADO — foi a última tentativa por agora. Espere 15 minutos.";
  return `PIN ERRADO — ${restantes === 1 ? "resta 1 tentativa" : `restam ${restantes} tentativas`}.`;
}
