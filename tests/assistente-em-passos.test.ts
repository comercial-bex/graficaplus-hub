import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistenteEmPassos } from "@/components/bex/assistente-em-passos";

describe("a casca dos assistentes", () => {
  it("é um diálogo: fechado, não desenha nada", () => {
    const html = renderToStaticMarkup(
      createElement(
        AssistenteEmPassos,
        {
          aberto: false,
          onFechar: () => {},
          titulo: "X",
          passos: [{ n: 1, titulo: "Um", pergunta: "?" }],
          atual: 1,
          onIr: () => {},
          pendencia: null,
          rotuloCriar: "Criar",
          onCriar: () => {},
        },
        "conteúdo",
      ),
    );
    expect(html).toBe("");
  });
});
