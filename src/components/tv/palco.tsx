import { useLayoutEffect, useState, type ReactNode } from "react";

/**
 * O palco: 1920×1080 fixos, escalados INTEIROS para a janela do aparelho.
 *
 * Smart TV costuma informar 1280×720 ao navegador; um mini PC, 1920×1080; um
 * monitor de teste, qualquer coisa. Em vez de layout fluido (que muda o que
 * cabe), a tela é desenhada uma vez em 1920×1080 e o palco recebe
 * `transform: scale(k)`, centralizado. Medido na maquete: a mesma tela, menor,
 * sem rolagem e com as cinco colunas inteiras.
 *
 * Fica invisível até o primeiro cálculo (depois de montar): no servidor não
 * há janela para medir, e mostrar o palco em escala 1 por um instante seria
 * um salto na parede. `useLayoutEffect` roda antes de pintar.
 */
export function Palco({ etiqueta, children }: { etiqueta?: string | null; children: ReactNode }) {
  const [escala, setEscala] = useState<{ k: number; left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const escalar = () => {
      const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      setEscala({
        k,
        left: Math.round((window.innerWidth - 1920 * k) / 2),
        top: Math.round((window.innerHeight - 1080 * k) / 2),
      });
    };
    escalar();
    window.addEventListener("resize", escalar);
    return () => window.removeEventListener("resize", escalar);
  }, []);

  return (
    <div
      className="tvo-palco"
      data-escala={escala ? escala.k.toFixed(4) : undefined}
      style={
        escala
          ? { transform: `scale(${escala.k})`, left: escala.left, top: escala.top }
          : { visibility: "hidden" }
      }
    >
      {etiqueta ? (
        <div className="etiqueta">
          <span>{etiqueta}</span>
        </div>
      ) : null}
      {children}
    </div>
  );
}
