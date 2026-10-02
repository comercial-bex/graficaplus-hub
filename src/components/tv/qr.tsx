import { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * O QR do pareamento, desenhado como SVG: módulos pretos sobre branco, com a
 * zona de silêncio que a câmera precisa. `qrcode-generator` (MIT, sem
 * dependência) faz a conta; o SVG escala com o palco sem perder nitidez.
 *
 * O texto é SÓ a url de aprovação com o código — o mesmo que já está escrito
 * na parede em letra grande. Nunca o id do pedido nem o segredo de retirada.
 */
export function Qr({ texto }: { texto: string }) {
  const modulos = useMemo(() => {
    // Nível M: 15% de correção, suficiente para uma câmera de celular a 1 m;
    // tipo 0 deixa a biblioteca escolher o menor tamanho que cabe.
    const qr = qrcode(0, "M");
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount();
    const quadrados: string[] = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) quadrados.push(`M${c} ${r}h1v1h-1z`);
    }
    return { n, caminho: quadrados.join("") };
  }, [texto]);

  const margem = 2;
  const lado = modulos.n + margem * 2;
  return (
    <svg
      viewBox={`0 0 ${lado} ${lado}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR para parear a TV"
    >
      <rect width={lado} height={lado} fill="#fff" />
      <path d={modulos.caminho} fill="#050506" transform={`translate(${margem} ${margem})`} />
    </svg>
  );
}
