import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import tvCss from "@/components/tv/tv-oficina.css?url";
import { TvAoVivo } from "@/components/tv/tv-ao-vivo";
import { TvDeExemplo } from "@/components/tv/tv-de-exemplo";
import { modoDeExemplo, type ModoDeExemplo } from "@/domain/tv/exemplo";

/**
 * /tv/maquinas — a TV da Oficina: UMA tela de parede, sem rolagem, com as
 * cinco máquinas lado a lado. Página PÚBLICA, sem login e sem o layout da
 * equipe (menu, faixa de alerta): a TV não tem login. Ela entra digitando o
 * PIN da TV no teclado da própria tela (decisão do dono, 05/10/2026) ou pelo
 * código que mostra, aprovado por admin ou gestor (pareamento). Nos dois
 * casos ganha um crachá revogável em /telas.
 *
 * Fica fora de `_authenticated` de propósito. O que protege a parede não é
 * esta rota: é a rota de servidor `/api/tv/painel`, que só responde ao crachá
 * da TV e só devolve o que `tv_painel_maquinas()` monta — sem dinheiro, sem
 * cliente, sem texto digitado.
 *
 * `?demo=cheio` e `?demo=hoje` desenham a tela com dado embutido, sem rede e
 * sem crachá, com a aba "EXEMPLO SIMULADO" no alto: é para testar o aparelho
 * e para fotografar.
 *
 * SSR: o servidor manda só a casca preta. Tudo que depende de janela, relógio
 * ou storage desenha depois de montar — assim não há erro de hidratação (um
 * relógio renderizado no servidor nunca bate com o do navegador).
 */
export const Route = createFileRoute("/tv/maquinas")({
  head: () => ({
    meta: [{ title: "Máquinas agora — TV da Oficina" }, { name: "robots", content: "noindex" }],
    links: [{ rel: "stylesheet", href: tvCss }],
  }),
  validateSearch: (busca: Record<string, unknown>): { demo?: ModoDeExemplo } => {
    const demo = modoDeExemplo(busca.demo);
    return demo ? { demo } : {};
  },
  component: TvDaOficina,
});

function useMontado(): boolean {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  return montado;
}

function TvDaOficina() {
  const { demo } = Route.useSearch();
  const montado = useMontado();
  return (
    <div className="tvo" data-modo={demo ? `exemplo-${demo}` : "real"}>
      {montado ? demo ? <TvDeExemplo modo={demo} /> : <TvAoVivo /> : null}
    </div>
  );
}
