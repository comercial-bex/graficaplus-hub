/**
 * MD5 em TypeScript puro, só para a marca de "mensagem repetida" da triagem.
 *
 * A coluna `whatsapp_triagens.ultima_entrada_hash` exige 32 caracteres
 * hexadecimais (o md5 do texto normalizado), para achar mensagem repetida sem
 * guardar o que a pessoa escreveu. O navegador e o servidor da hospedagem não
 * têm md5 em `crypto.subtle`, e `node:crypto` não existe no ambiente de
 * execução do servidor, então o cálculo mora aqui. Não é segurança: é um
 * carimbo de comparação. O teste confere a saída contra o md5 do Node.
 */

const DESLOCAMENTOS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const CONSTANTES = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0,
);

function girar(valor: number, bits: number): number {
  return ((valor << bits) | (valor >>> (32 - bits))) >>> 0;
}

function emHexLittleEndian(valor: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += ((valor >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  return s;
}

export function md5(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  const comprimento = bytes.length;
  const total = (((comprimento + 8) >>> 6) + 1) << 6;
  const bloco = new Uint8Array(total);
  bloco.set(bytes);
  bloco[comprimento] = 0x80;
  const visao = new DataView(bloco.buffer);
  visao.setUint32(total - 8, (comprimento << 3) >>> 0, true);
  visao.setUint32(total - 4, Math.floor(comprimento / 0x20000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let inicio = 0; inicio < total; inicio += 64) {
    const m = Array.from({ length: 16 }, (_, i) => visao.getUint32(inicio + i * 4, true));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + CONSTANTES[i] + m[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + girar(f, DESLOCAMENTOS[i])) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return (
    emHexLittleEndian(a0) + emHexLittleEndian(b0) + emHexLittleEndian(c0) + emHexLittleEndian(d0)
  );
}
