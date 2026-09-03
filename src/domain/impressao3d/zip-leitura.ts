import { inflateRawSync } from "node:zlib";

/**
 * Leitor de ZIP mínimo, só o que o 3MF precisa.
 *
 * Um `.3mf` é um ZIP. O parser antigo fazia `buffer.toString("utf8")` e
 * procurava ";FLAVOR" como texto — num arquivo deflate-comprimido isso nunca
 * aparece, então todo 3MF real caía no caminho "não consegui ler" e devolvia
 * peso e tempo indefinidos, calado. É a exportação nativa da Bambu Lab A1.
 *
 * Node traz `zlib.inflateRawSync`, que é tudo que falta: o resto do ZIP é
 * cabeçalho. Sem dependência nova.
 */

export type EntradaZip = { nome: string; tamanho: number; ler: () => Buffer };

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;

export type LimitesZip = {
  /** Quantas entradas do arquivo vale a pena percorrer. */
  maxEntradas: number;
  /** Teto do que uma única entrada pode ocupar descomprimida. */
  maxBytesPorEntrada: number;
  /** Teto da soma de tudo descomprimido — trava contra zip bomb. */
  maxBytesTotais: number;
};

/**
 * Lista as entradas pelo diretório central (o fim do arquivo), e não pelos
 * cabeçalhos locais: em ZIP escrito em fluxo os tamanhos locais vêm zerados e
 * ficam num descritor depois dos dados, o que levaria a ler lixo.
 */
export function lerEntradasZip(buffer: Buffer, limites: LimitesZip): EntradaZip[] {
  const eocd = acharEOCD(buffer);
  if (eocd < 0) throw new Error("Arquivo não é um ZIP válido (fim do diretório não encontrado)");

  const totalEntradas = buffer.readUInt16LE(eocd + 10);
  const inicioCentral = buffer.readUInt32LE(eocd + 16);
  if (inicioCentral >= buffer.byteLength) throw new Error("Diretório do ZIP aponta para fora do arquivo");

  const entradas: EntradaZip[] = [];
  let somaDescomprimida = 0;
  let cursor = inicioCentral;

  for (let i = 0; i < Math.min(totalEntradas, limites.maxEntradas); i++) {
    if (cursor + 46 > buffer.byteLength) break;
    if (buffer.readUInt32LE(cursor) !== ASSINATURA_CENTRAL) break;

    const metodo = buffer.readUInt16LE(cursor + 10);
    const tamComprimido = buffer.readUInt32LE(cursor + 20);
    const tamOriginal = buffer.readUInt32LE(cursor + 24);
    const tamNome = buffer.readUInt16LE(cursor + 28);
    const tamExtra = buffer.readUInt16LE(cursor + 30);
    const tamComentario = buffer.readUInt16LE(cursor + 32);
    const offsetLocal = buffer.readUInt32LE(cursor + 42);
    const nome = buffer.toString("utf8", cursor + 46, cursor + 46 + tamNome);

    cursor += 46 + tamNome + tamExtra + tamComentario;

    if (nome.endsWith("/")) continue;

    // Entrada acima do teto RECUSA o arquivo, não é pulada.
    //
    // Pular calado era o mesmo defeito que este leitor veio consertar: o 3MF
    // parecia lido, vinha sem peso nem tempo, e ninguém sabia por quê. Zip bomb
    // e G-code legitimamente enorme dão a mesma resposta — e as duas merecem
    // uma mensagem, não silêncio.
    if (tamOriginal > limites.maxBytesPorEntrada) {
      throw new Error(
        `Contêiner 3MF excede limite de expansão: "${nome}" tem ${Math.round(tamOriginal / 1048576)} MB descomprimido`,
      );
    }

    somaDescomprimida += tamOriginal;
    if (somaDescomprimida > limites.maxBytesTotais) {
      throw new Error("Contêiner 3MF excede limite de expansão (soma das entradas)");
    }

    entradas.push({
      nome,
      tamanho: tamOriginal,
      // Preguiçoso de propósito: descomprimir só o que for realmente lido.
      ler: () => {
        if (offsetLocal + 30 > buffer.byteLength) throw new Error(`Entrada corrompida: ${nome}`);
        const tamNomeLocal = buffer.readUInt16LE(offsetLocal + 26);
        const tamExtraLocal = buffer.readUInt16LE(offsetLocal + 28);
        const inicioDados = offsetLocal + 30 + tamNomeLocal + tamExtraLocal;
        const dados = buffer.subarray(inicioDados, inicioDados + tamComprimido);
        if (metodo === 0) return Buffer.from(dados);
        if (metodo === 8) return inflateRawSync(dados, { maxOutputLength: limites.maxBytesPorEntrada });
        throw new Error(`Compressão não suportada no ZIP (método ${metodo})`);
      },
    });
  }

  return entradas;
}

/**
 * O EOCD fica no fim, mas pode ter até 64 KB de comentário depois dele — por
 * isso a busca é de trás para frente, e não uma leitura de posição fixa.
 */
function acharEOCD(buffer: Buffer): number {
  const minimo = Math.max(0, buffer.byteLength - 22 - 0xffff);
  for (let i = buffer.byteLength - 22; i >= minimo; i--) {
    if (buffer.readUInt32LE(i) === ASSINATURA_EOCD) return i;
  }
  return -1;
}
